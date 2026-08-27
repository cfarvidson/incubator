import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ClaudeProfileConfig } from "./claude-profile.js";

export interface Config {
  cloneRoots: string[];
  /** The Duration Cap per Card Session. */
  durationCapMinutes: number;
  /** Stop Time as HH:MM. */
  stopTime: string;
  /** Model for Card Sessions; null means the Claude CLI's own default. */
  model: string | null;
  /** Claude Profiles by name; a real run picks one with --claude <name>. */
  claudes: Record<string, ClaudeProfileConfig>;
}

const CONFIG_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "incubator.config.json");

export function loadConfig(): Config {
  const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Partial<Config>;
  const stopTime = raw.stopTime ?? "07:00";
  // A malformed Stop Time would otherwise silently never fire (Invalid Date compares false).
  if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(stopTime)) {
    throw new Error(`stopTime in incubator.config.json must be HH:MM (24h), got "${stopTime}"`);
  }
  if (!raw.cloneRoots?.length) {
    throw new Error("cloneRoots in incubator.config.json is required");
  }
  return {
    cloneRoots: raw.cloneRoots.map(expandHome),
    durationCapMinutes: raw.durationCapMinutes ?? 120,
    stopTime,
    model: raw.model ?? null,
    claudes: raw.claudes ?? {},
  };
}

function expandHome(path: string): string {
  return resolve(path.startsWith("~/") ? join(homedir(), path.slice(2)) : path);
}
