import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ResolveClone } from "../core/types.js";

/** Clones live by repo name (not owner) directly under each root, e.g. ~/code/TV4/<name>. */
export function makeCloneResolver(cloneRoots: string[]): ResolveClone {
  return (repo) => {
    const name = repo.split("/")[1];
    if (!name) return null;
    for (const root of cloneRoots) {
      const path = join(root, name);
      if (existsSync(join(path, ".git"))) return path;
    }
    return null;
  };
}
