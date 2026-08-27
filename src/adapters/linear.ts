import { RateLimitError } from "../core/rate-limit.js";
import type { Card, LinearPort } from "../core/types.js";

/** The Night Queue filter per ADR-0002: assigned to me + Todo + label `ready-for-agent`, any team. */
export const NIGHT_QUEUE_FILTER = {
  assignee: { isMe: { eq: true } },
  state: { name: { eq: "Todo" } },
  labels: { name: { eq: "ready-for-agent" } },
};

interface Label {
  id: string;
  name: string;
}

/** The Bounce label swap: drop `ready-for-agent`, add the team's own `needs-info` (matched by name). */
export function swapLabelsForBounce(issueLabels: Label[], teamLabels: Label[]): string[] {
  const needsInfo = teamLabels.find((label) => label.name === "needs-info");
  if (!needsInfo) {
    throw new Error('The Card\'s team has no label named "needs-info"; create it so Bounces can be labeled');
  }
  const kept = issueLabels.filter((label) => label.name !== "ready-for-agent").map((label) => label.id);
  return kept.includes(needsInfo.id) ? kept : [...kept, needsInfo.id];
}

const QUEUE_QUERY = `
  query NightQueue($filter: IssueFilter) {
    issues(first: 100, filter: $filter) {
      pageInfo {
        hasNextPage
      }
      nodes {
        identifier
        title
        description
        priority
        url
        branchName
      }
    }
  }
`;

const STATES_QUERY = `
  query IssueStates($id: String!) {
    issue(id: $id) {
      id
      team {
        states {
          nodes {
            id
            name
          }
        }
      }
    }
  }
`;

const UPDATE_STATE_MUTATION = `
  mutation UpdateIssueState($id: String!, $stateId: String!) {
    issueUpdate(id: $id, input: { stateId: $stateId }) {
      success
    }
  }
`;

const BOUNCE_QUERY = `
  query IssueForBounce($id: String!) {
    issue(id: $id) {
      id
      labels {
        nodes {
          id
          name
        }
      }
      team {
        states {
          nodes {
            id
            name
          }
        }
        labels {
          nodes {
            id
            name
          }
        }
      }
    }
  }
`;

const BOUNCE_MUTATION = `
  mutation BounceIssue($id: String!, $stateId: String!, $labelIds: [String!]!) {
    issueUpdate(id: $id, input: { stateId: $stateId, labelIds: $labelIds }) {
      success
    }
  }
`;

const COMMENT_MUTATION = `
  mutation CommentOnIssue($issueId: String!, $body: String!) {
    commentCreate(input: { issueId: $issueId, body: $body }) {
      success
    }
  }
`;

export function makeLinearPort(): LinearPort & { checkAuth(): Promise<void> } {
  const apiKey = process.env["LINEAR_API_KEY"];
  if (!apiKey) {
    throw new Error(
      "LINEAR_API_KEY is not set. Create a personal API key at linear.app > Settings > Security & access > Personal API keys.",
    );
  }

  async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const response = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: apiKey! },
      body: JSON.stringify({ query, variables }),
    });
    if (response.status === 429) {
      throw new RateLimitError("Linear API rate limited (429)");
    }
    if (!response.ok) {
      throw new Error(`Linear API request failed: ${response.status} ${await response.text()}`);
    }
    const json = (await response.json()) as {
      errors?: { message: string; extensions?: { code?: string } }[];
      data?: T;
    };
    if (json.errors?.some((e) => e.extensions?.code === "RATELIMITED")) {
      throw new RateLimitError("Linear API rate limited (RATELIMITED)");
    }
    if (json.errors?.length || !json.data) {
      throw new Error(`Linear API error: ${json.errors?.map((e) => e.message).join("; ") ?? "no data"}`);
    }
    return json.data;
  }

  async function moveToState(card: Card, stateName: string): Promise<string> {
    const data = await gql<{ issue: { id: string; team: { states: { nodes: { id: string; name: string }[] } } } }>(
      STATES_QUERY,
      { id: card.identifier },
    );
    const state = data.issue.team.states.nodes.find((s) => s.name === stateName);
    if (!state) {
      throw new Error(`Team of ${card.identifier} has no state named "${stateName}"`);
    }
    await gql(UPDATE_STATE_MUTATION, { id: data.issue.id, stateId: state.id });
    return data.issue.id;
  }

  return {
    /** Fail fast at startup on dead auth, so a broken token is found at 18:00, not at 03:00. */
    async checkAuth(): Promise<void> {
      try {
        await gql<{ viewer: { id: string } }>("query { viewer { id } }", {});
      } catch (error) {
        if (error instanceof RateLimitError) throw error;
        throw new Error(
          [
            "Linear authentication failed; nothing was run.",
            error instanceof Error ? error.message : String(error),
            "Create a new personal API key at linear.app > Settings > Security & access > Personal API keys and update LINEAR_API_KEY.",
          ].join("\n"),
        );
      }
    },

    async fetchNightQueue(): Promise<Card[]> {
      const data = await gql<{
        issues: {
          pageInfo: { hasNextPage: boolean };
          nodes: {
            identifier: string;
            title: string;
            description: string | null;
            priority: number;
            url: string;
            branchName: string;
          }[];
        };
      }>(QUEUE_QUERY, { filter: NIGHT_QUEUE_FILTER });
      if (data.issues.pageInfo.hasNextPage) {
        console.error("Warning: the Night Queue has more than 100 Cards; the Plan only covers the first 100.");
      }
      return data.issues.nodes.map(({ description, ...node }) => ({
        ...node,
        brief: description ?? "",
      }));
    },

    async claim(card: Card): Promise<void> {
      await moveToState(card, "In Progress");
    },

    async markInReview(card: Card, prUrls: string[]): Promise<void> {
      const issueId = await moveToState(card, "In Review");
      const body = ["Night Run result: done.", "", ...prUrls.map((url) => `- ${url}`)].join("\n");
      await gql(COMMENT_MUTATION, { issueId, body });
    },

    async bounce(card: Card, reason: string): Promise<void> {
      const data = await gql<{
        issue: {
          id: string;
          labels: { nodes: Label[] };
          team: { states: { nodes: { id: string; name: string }[] }; labels: { nodes: Label[] } };
        };
      }>(BOUNCE_QUERY, { id: card.identifier });
      const todo = data.issue.team.states.nodes.find((s) => s.name === "Todo");
      if (!todo) {
        throw new Error(`Team of ${card.identifier} has no state named "Todo"`);
      }
      const labelIds = swapLabelsForBounce(data.issue.labels.nodes, data.issue.team.labels.nodes);
      await gql(BOUNCE_MUTATION, { id: data.issue.id, stateId: todo.id, labelIds });
      const body = ["Night Run result: Bounced.", "", reason].join("\n");
      await gql(COMMENT_MUTATION, { issueId: data.issue.id, body });
    },
  };
}
