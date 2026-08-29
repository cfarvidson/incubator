import type { TrackerConfig } from "../config.js";
import type { TrackerPort } from "../core/types.js";
import { githubSessionHints, makeGithubPort } from "./github.js";
import { linearSessionHints, makeLinearPort } from "./linear.js";
import type { TrackerSessionHints } from "./session-policy.js";

/** The one place a tracker kind maps to its adapter and session hints; a new tracker is added here. */
export function makeTracker(config: TrackerConfig): { tracker: TrackerPort; sessionHints: TrackerSessionHints } {
  return config.kind === "github"
    ? { tracker: makeGithubPort(config.scope), sessionHints: githubSessionHints }
    : { tracker: makeLinearPort(), sessionHints: linearSessionHints };
}
