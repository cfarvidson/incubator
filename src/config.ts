import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface Config {
  cloneRoots: string[];
}

const CONFIG_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "incubator.config.json");

export function loadConfig(): Config {
  const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Config;
  return { cloneRoots: raw.cloneRoots.map(expandHome) };
}

function expandHome(path: string): string {
  return resolve(path.startsWith("~/") ? join(homedir(), path.slice(2)) : path);
}
