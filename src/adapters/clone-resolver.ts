import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ResolveClone } from "../core/types.js";

/**
 * Clones live by repo name (not owner) directly under each root, e.g. ~/code/TV4/<name>.
 * The clone's git config must mention the full `owner/name`, so a Repo Line naming a repo
 * the user has no clone of never resolves to someone else's same-named directory.
 */
export function makeCloneResolver(cloneRoots: string[]): ResolveClone {
  return (repo) => {
    const name = repo.split("/")[1];
    if (!name) return null;
    for (const root of cloneRoots) {
      const path = join(root, name);
      if (!existsSync(join(path, ".git"))) continue;
      try {
        if (readFileSync(join(path, ".git", "config"), "utf8").includes(repo)) return path;
      } catch {
        continue;
      }
    }
    return null;
  };
}
