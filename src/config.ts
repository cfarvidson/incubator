import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ClaudeProfileConfig } from "./claude-profile.js";

/** Which tracker a Tracker Profile serves Cards from, plus what that tracker needs to find them. */
export type TrackerConfig =
  | { kind: "linear" }
  /** `scope`: GitHub owners (`cfarvidson`) and/or repos (`owner/name`) searched for Cards. */
  | { kind: "github"; scope: string[] };

/** A Tracker Profile: where Cards live and how this machine runs them. Picked with --profile. */
export interface TrackerProfile {
  name: string;
  tracker: TrackerConfig;
  cloneRoots: string[];
  /** Default Claude Profile for this Tracker Profile; `--claude` overrides. */
  claude: string | null;
}

export interface Config {
  /** The Duration Cap per Card Session. */
  durationCapMinutes: number;
  /** Stop Time as HH:MM. */
  stopTime: string;
  /** Model for Card Sessions; null means the Claude CLI's own default. */
  model: string | null;
  /** Claude Profiles by name; a real run picks one with --claude <name> or the Tracker Profile's default. */
  claudes: Record<string, ClaudeProfileConfig>;
  /** Tracker Profiles by name; every run works under exactly one. */
  profiles: Record<string, TrackerProfile>;
  /** The Tracker Profile used when --profile is omitted; null means it must be named (unless only one exists). */
  defaultProfile: string | null;
}

const CONFIG_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "incubator.config.json");

interface RawProfile {
  tracker?: { kind?: string; scope?: string[] };
  cloneRoots?: string[];
  claude?: string;
}

export function loadConfig(path: string = CONFIG_PATH): Config {
  const raw = JSON.parse(readFileSync(path, "utf8")) as {
    durationCapMinutes?: number;
    stopTime?: string;
    model?: string | null;
    claudes?: Record<string, ClaudeProfileConfig>;
    profiles?: Record<string, RawProfile>;
    defaultProfile?: string;
  };
  const stopTime = raw.stopTime ?? "07:00";
  // A malformed Stop Time would otherwise silently never fire (Invalid Date compares false).
  if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(stopTime)) {
    throw new Error(`stopTime in incubator.config.json must be HH:MM (24h), got "${stopTime}"`);
  }
  const rawProfiles = raw.profiles ?? {};
  const names = Object.keys(rawProfiles);
  if (names.length === 0) {
    throw new Error('profiles in incubator.config.json is required: at least one Tracker Profile with "tracker" and "cloneRoots"');
  }
  const profiles = Object.fromEntries(names.map((name) => [name, loadProfile(name, rawProfiles[name]!)]));
  if (raw.defaultProfile !== undefined && !profiles[raw.defaultProfile]) {
    throw new Error(`defaultProfile "${raw.defaultProfile}" names no profile in incubator.config.json`);
  }
  return {
    durationCapMinutes: raw.durationCapMinutes ?? 120,
    stopTime,
    model: raw.model ?? null,
    claudes: raw.claudes ?? {},
    profiles,
    defaultProfile: raw.defaultProfile ?? null,
  };
}

function loadProfile(name: string, raw: RawProfile): TrackerProfile {
  if (!raw.cloneRoots?.length) {
    throw new Error(`Profile "${name}" in incubator.config.json needs cloneRoots`);
  }
  const kind = raw.tracker?.kind;
  let tracker: TrackerConfig;
  if (kind === "linear") {
    tracker = { kind };
  } else if (kind === "github") {
    if (!raw.tracker?.scope?.length) {
      throw new Error(`Profile "${name}": a github tracker needs a scope (owners and/or owner/name repos to search)`);
    }
    tracker = { kind, scope: raw.tracker.scope };
  } else {
    throw new Error(`Profile "${name}": tracker.kind must be "linear" or "github", got ${JSON.stringify(kind)}`);
  }
  return { name, tracker, cloneRoots: raw.cloneRoots.map(expandHome), claude: raw.claude ?? null };
}

/** Picks the Tracker Profile for this run: --profile <name>, else defaultProfile, else the sole profile. */
export function resolveTrackerProfile(argv: string[], config: Config): TrackerProfile {
  const names = Object.keys(config.profiles);
  const listing = `Configured profiles: ${names.map((n) => `"${n}"`).join(", ")}`;
  const flagIndex = argv.indexOf("--profile");
  if (flagIndex !== -1) {
    const name = argv[flagIndex + 1];
    if (!name || name.startsWith("-")) throw new Error(`--profile requires a profile name. ${listing}`);
    const profile = config.profiles[name];
    if (!profile) throw new Error(`Unknown profile "${name}". ${listing}`);
    return profile;
  }
  if (config.defaultProfile) return config.profiles[config.defaultProfile]!;
  if (names.length === 1) return config.profiles[names[0]!]!;
  throw new Error(`Multiple profiles and no defaultProfile; pick one with --profile <name>. ${listing}`);
}

function expandHome(path: string): string {
  return resolve(path.startsWith("~/") ? join(homedir(), path.slice(2)) : path);
}
