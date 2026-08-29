import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ResolveClone } from "../core/types.js";

/**
 * Clones live by repo name (not owner) directly under each root, e.g. ~/code/TV4/<name>.
 * The clone's `origin` remote must point at exactly `owner/name` (ssh or https, with or
 * without a `.git` suffix), so a Repo Line never resolves to a fork or a same-named
 * directory whose origin merely mentions the repo.
 */
export function makeCloneResolver(cloneRoots: string[]): ResolveClone {
  return (repo) => {
    const name = repo.split("/")[1];
    if (!name) return null;
    for (const root of cloneRoots) {
      const path = join(root, name);
      if (!existsSync(join(path, ".git"))) continue;
      try {
        const origin = originUrl(readFileSync(join(path, ".git", "config"), "utf8"));
        if (origin && ownerName(origin) === repo.toLowerCase()) return path;
      } catch {
        continue;
      }
    }
    return null;
  };
}

/** The `url` of the `origin` remote in a .git/config, or null when there is none. */
function originUrl(gitConfig: string): string | null {
  let inOrigin = false;
  for (const line of gitConfig.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      inOrigin = trimmed === '[remote "origin"]';
    } else if (inOrigin) {
      const url = trimmed.match(/^url\s*=\s*(.+)$/);
      if (url) return url[1]!.trim();
    }
  }
  return null;
}

/** Normalizes an ssh/https remote URL to lowercase `owner/name`, or null if it is neither. */
function ownerName(url: string): string | null {
  const path = url
    .replace(/^[a-z][\w+.-]*:\/\/(?:[^/@]+@)?[^/]+\//i, "") // https://host/ or ssh://user@host[:port]/
    .replace(/^[^/@]+@[^/:]+:/, "") // git@host:
    .replace(/\.git$/i, "")
    .replace(/\/$/, "");
  const segments = path.split("/");
  if (segments.length !== 2 || !segments[0] || !segments[1]) return null;
  return path.toLowerCase();
}
