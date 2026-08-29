import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { RateLimitError } from "../core/rate-limit.js";
import type { Card, TrackerPort } from "../core/types.js";
import { CLAIM_COMMENT, isStranded } from "./claim-marker.js";
import type { TrackerSessionHints } from "./session-policy.js";

/** A Card Session comments on its GitHub Card with the gh CLI it already has (Bash is in the base tool list). */
export const githubSessionHints: TrackerSessionHints = {
  allowedTools: [],
  howToComment: (card) => `with \`gh issue comment ${card.url}\``,
};

/** Runs one `gh` invocation and returns stdout; the seam the tests fake. */
export type GhRunner = (args: string[]) => Promise<string>;

/** gh surfaces both primary and secondary limits as HTTP 403/429 with these phrasings. */
const RATE_LIMIT_OUTPUT = /rate limit|HTTP 429|too many requests/i;

const execFileAsync = promisify(execFile);

const runGh: GhRunner = async (args) => {
  try {
    const { stdout } = await execFileAsync("gh", args, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    // execFile appends stderr to the message, which carries gh's own diagnosis.
    const message = error instanceof Error ? error.message : String(error);
    if (RATE_LIMIT_OUTPUT.test(message)) throw new RateLimitError(`GitHub API rate limited: ${message}`);
    throw new Error(`gh ${args.slice(0, 2).join(" ")} failed: ${message}`);
  }
};

/** A scope entry names a GitHub owner (`cfarvidson`) or a single repo (`owner/name`); ADR-0003. */
function scopeFlag(entry: string): string[] {
  return entry.includes("/") ? ["--repo", entry] : ["--owner", entry];
}

/** GitHub has no priority field; `priority:*` labels map onto Linear's scale, the most urgent winning. */
const PRIORITY_LABELS: Record<string, number> = {
  "priority:urgent": 1,
  "priority:high": 2,
  "priority:medium": 3,
  "priority:low": 4,
};

export function priorityFromLabels(labelNames: string[]): number {
  const matched = labelNames
    .map((name) => PRIORITY_LABELS[name.toLowerCase()])
    .filter((priority): priority is number => priority !== undefined);
  return matched.length > 0 ? Math.min(...matched) : 0;
}

/** GitHub suggests no branch name the way Linear does, so the adapter generates one. */
export function branchNameFor(issueNumber: number, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40)
    .replace(/-$/, "");
  return slug ? `night/${issueNumber}-${slug}` : `night/${issueNumber}`;
}

interface SearchNode {
  title: string;
  body: string | null;
  url: string;
  number: number;
  labels: { name: string }[];
  repository: { nameWithOwner: string };
}

const SEARCH_JSON = "title,body,url,number,labels,repository";

export function makeGithubPort(scope: string[], gh: GhRunner = runGh): TrackerPort {
  // The onboarding check behind Card.canBounce, cached per repo for the run.
  const needsInfoByRepo = new Map<string, Promise<boolean>>();
  const ensuredLabels = new Set<string>();

  function repoHasNeedsInfo(repo: string): Promise<boolean> {
    let cached = needsInfoByRepo.get(repo);
    if (!cached) {
      cached = gh(["label", "list", "-R", repo, "--json", "name"]).then((out) =>
        (JSON.parse(out) as { name: string }[]).some((label) => label.name === "needs-info"),
      );
      needsInfoByRepo.set(repo, cached);
    }
    return cached;
  }

  /** The runner-written labels beyond `needs-info` (the onboarding contract) are created on demand. */
  async function ensureLabel(repo: string, name: string): Promise<void> {
    const key = `${repo}:${name}`;
    if (ensuredLabels.has(key)) return;
    try {
      await gh(["label", "create", name, "-R", repo, "--color", "ededed"]);
    } catch (error) {
      if (error instanceof RateLimitError) throw error;
      // Already existing is the usual and desired outcome; a real failure resurfaces on the edit that follows.
    }
    ensuredLabels.add(key);
  }

  async function search(extraTerms: string[]): Promise<SearchNode[]> {
    // GitHub ANDs search qualifiers, so it is one query per scope entry, unioned by URL:
    // a single query naming two owners (or an owner plus a foreign repo) would return
    // their intersection - an empty Night Queue.
    const byUrl = new Map<string, SearchNode>();
    for (const entry of scope) {
      const out = await gh([
        "search",
        "issues",
        "--assignee",
        "@me",
        "--state",
        "open",
        "--label",
        "ready-for-agent",
        "--limit",
        "100",
        "--json",
        SEARCH_JSON,
        ...scopeFlag(entry),
        "--",
        ...extraTerms,
      ]);
      const nodes = JSON.parse(out) as SearchNode[];
      if (nodes.length === 100) {
        console.error(`Warning: 100+ Cards match in ${entry}; only the first 100 are seen.`);
      }
      for (const node of nodes) byUrl.set(node.url, node);
    }
    return [...byUrl.values()];
  }

  function toCards(nodes: SearchNode[]): Promise<Card[]> {
    return Promise.all(
      nodes.map(async (node) => ({
        identifier: `${node.repository.nameWithOwner}#${node.number}`,
        title: node.title,
        brief: node.body ?? "",
        priority: priorityFromLabels(node.labels.map((label) => label.name)),
        url: node.url,
        branchName: branchNameFor(node.number, node.title),
        canBounce: await repoHasNeedsInfo(node.repository.nameWithOwner),
        homeRepo: node.repository.nameWithOwner,
      })),
    );
  }

  function repoOf(card: Card): string {
    if (!card.homeRepo) throw new Error(`${card.identifier} has no Home Repo; it was not served by the GitHub adapter`);
    return card.homeRepo;
  }

  return {
    /** Fail fast at startup on dead auth, so a broken login is found at 18:00, not at 03:00. */
    async checkAuth(): Promise<void> {
      try {
        await gh(["auth", "status"]);
      } catch (error) {
        if (error instanceof RateLimitError) throw error;
        throw new Error(
          [
            "GitHub authentication failed; nothing was run.",
            error instanceof Error ? error.message : String(error),
            "Run `gh auth login` (or refresh the token) and start the night again.",
          ].join("\n"),
        );
      }
    },

    async fetchNightQueue(): Promise<Card[]> {
      // GitHub has no workflow states; the `in-progress` label is the Claim marker, so queued = not yet Claimed.
      return toCards(await search(["-label:in-progress"]));
    },

    async fetchStranded(): Promise<Card[]> {
      const claimed = await search(["label:in-progress"]);
      const stranded: SearchNode[] = [];
      for (const node of claimed) {
        const out = await gh(["issue", "view", node.url, "--json", "comments"]);
        const comments = (JSON.parse(out) as { comments: { body: string; createdAt: string }[] }).comments;
        const bodies = [...comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((c) => c.body);
        if (isStranded(bodies)) stranded.push(node);
      }
      return toCards(stranded);
    },

    async claim(card: Card): Promise<void> {
      await ensureLabel(repoOf(card), "in-progress");
      await gh(["issue", "edit", card.url, "--add-label", "in-progress"]);
      // The marker that makes a dead run's Cards recognizable as Stranded tomorrow.
      await gh(["issue", "comment", card.url, "--body", CLAIM_COMMENT]);
    },

    async markInReview(card: Card, prUrls: string[]): Promise<void> {
      // Dropping `ready-for-agent` is what takes the Card out of the Night Queue; `in-review` says why.
      await ensureLabel(repoOf(card), "in-review");
      await gh(["issue", "edit", card.url, "--remove-label", "ready-for-agent,in-progress", "--add-label", "in-review"]);
      const body = ["Night Run result: done.", "", ...prUrls.map((url) => `- ${url}`)].join("\n");
      await gh(["issue", "comment", card.url, "--body", body]);
    },

    async bounce(card: Card, reason: string): Promise<void> {
      // A Plan-time Bounce may remove `in-progress` from a repo that never had the label; ensure it first.
      await ensureLabel(repoOf(card), "in-progress");
      await gh(["issue", "edit", card.url, "--remove-label", "ready-for-agent,in-progress", "--add-label", "needs-info"]);
      const body = ["Night Run result: Bounced.", "", reason].join("\n");
      await gh(["issue", "comment", card.url, "--body", body]);
    },
  };
}
