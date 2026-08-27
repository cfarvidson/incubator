import type { Card, LinearPort } from "../core/types.js";

/** The Night Queue filter per ADR-0002: assigned to me + Todo + label `ready-for-agent`, any team. */
export const NIGHT_QUEUE_FILTER = {
  assignee: { isMe: { eq: true } },
  state: { name: { eq: "Todo" } },
  labels: { name: { eq: "ready-for-agent" } },
};

const QUERY = `
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
      }
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
  return {
    async fetchNightQueue(): Promise<Card[]> {
      const response = await fetch("https://api.linear.app/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: apiKey },
        body: JSON.stringify({ query: QUERY, variables: { filter: NIGHT_QUEUE_FILTER } }),
      });
      if (!response.ok) {
        throw new Error(`Linear API request failed: ${response.status} ${await response.text()}`);
      }
      const json = (await response.json()) as {
        errors?: { message: string }[];
        data?: {
          issues: {
            pageInfo: { hasNextPage: boolean };
            nodes: { identifier: string; title: string; description: string | null; priority: number; url: string }[];
          };
        };
      };
      if (json.errors?.length || !json.data) {
        throw new Error(`Linear API error: ${json.errors?.map((e) => e.message).join("; ") ?? "no data"}`);
      }
      if (json.data.issues.pageInfo.hasNextPage) {
        console.error("Warning: the Night Queue has more than 100 Cards; the Plan only covers the first 100.");
      }
      return json.data.issues.nodes.map(({ description, ...node }) => ({ ...node, brief: description ?? "" }));
    },
  };
}
