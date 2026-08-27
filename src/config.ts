import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface Config {
  cloneRoots: string[];
  maxCardDurationMinutes: number;
  /** Stop Time as HH:MM. */
  stopTime: string;
  /** Model for Card Sessions; null means the Claude CLI's own default. */
  model: string | null;
}

const CONFIG_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "incubator.config.json");

export function loadConfig(): Config {
  const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Partial<Config>;
  return {
    cloneRoots: (raw.cloneRoots ?? ["~/code"]).map(expandHome),
    maxCardDurationMinutes: raw.maxCardDurationMinutes ?? 120,
    stopTime: raw.stopTime ?? "07:00",
    model: raw.model ?? null,
  };
}

function expandHome(path: string): string {
  return resolve(path.startsWith("~/") ? join(homedir(), path.slice(2)) : path);
}
