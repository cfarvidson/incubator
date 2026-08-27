import type { Card, LinearPort } from "../core/types.js";

/** The Night Queue filter per ADR-0002: assigned to me + Todo + label `ready-for-agent`, any team. */
export const NIGHT_QUEUE_FILTER = {
  assignee: { isMe: { eq: true } },
  state: { name: { eq: "Todo" } },
  labels: { name: { eq: "ready-for-agent" } },
};

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

const COMMENT_MUTATION = `
  mutation CommentOnIssue($issueId: String!, $body: String!) {
    commentCreate(input: { issueId: $issueId, body: $body }) {
      success
    }
  }
`;

export function makeLinearPort(): LinearPort {
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
    if (!response.ok) {
      throw new Error(`Linear API request failed: ${response.status} ${await response.text()}`);
    }
    const json = (await response.json()) as { errors?: { message: string }[]; data?: T };
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
  };
}
