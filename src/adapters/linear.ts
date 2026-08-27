import type { Card, LinearPort } from "../core/types.js";

const QUERY = `
  query NightQueue {
    issues(
      first: 100
      filter: {
        assignee: { isMe: { eq: true } }
        state: { name: { eq: "Todo" } }
        labels: { name: { eq: "ready-for-agent" } }
      }
    ) {
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
        body: JSON.stringify({ query: QUERY }),
      });
      if (!response.ok) {
        throw new Error(`Linear API request failed: ${response.status} ${await response.text()}`);
      }
      const json = (await response.json()) as {
        errors?: { message: string }[];
        data?: { issues: { nodes: (Card & { description: string | null })[] } };
      };
      if (json.errors?.length || !json.data) {
        throw new Error(`Linear API error: ${json.errors?.map((e) => e.message).join("; ") ?? "no data"}`);
      }
      return json.data.issues.nodes.map((node) => ({ ...node, description: node.description ?? "" }));
    },
  };
}
