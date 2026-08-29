import { homedir } from "node:os";
import { join } from "node:path";
import { flagValue } from "./flags.js";

/** How a harness CLI is driven: claude and codex have built-in argument shapes; custom brings its own. */
export type HarnessKind = "claude" | "codex" | "custom";

/** A Harness Profile as written in incubator.config.json under `harnesses`. */
export interface HarnessConfig {
  /** Which agent CLI family this is; decides the Card Session's argument shape. Defaults to "claude". */
  kind?: HarnessKind;
  /** The executable to spawn; defaults to the kind's own name. Required for kind "custom". */
  command?: string;
  /** Layered over the Runner's own environment when spawning Card Sessions. */
  env?: Record<string, string>;
  /** Model for Card Sessions; omitted uses the harness CLI's own default. `--model` overrides. */
  model?: string;
  /** Argument template with "{prompt}" for the session prompt; replaces the kind's built-in shape. */
  args?: string[];
}

/** A resolved Harness Profile: which agent CLI (and credentials) this Night Run's Card Sessions use. */
export interface HarnessProfile {
  name: string;
  kind: HarnessKind;
  command: string;
  env: Record<string, string>;
  model: string | null;
  args: string[] | null;
}

const KINDS: readonly HarnessKind[] = ["claude", "codex", "custom"];

/** Only `~/`-prefixed values are paths to expand; anything else (commands on PATH, tokens, URLs) stays verbatim. */
function expandHome(value: string): string {
  return value.startsWith("~/") ? join(homedir(), value.slice(2)) : value;
}

/**
 * Picks the Harness Profile named by `--harness <name>`, falling back to the
 * Tracker Profile's default (`defaultName`). Required for a real run (fail-fast,
 * before any tracker reads or writes); a dry run may omit it but a given name
 * is still validated. Returns null only when unnamed and not required.
 * `--model` overrides the profile's model for this run.
 */
export function resolveHarnessProfile(
  argv: string[],
  harnesses: Record<string, HarnessConfig>,
  options: { required: boolean; defaultName?: string | null },
): HarnessProfile | null {
  if (!argv.includes("--harness") && !options.defaultName && !options.required) return null;

  const names = Object.keys(harnesses);
  if (names.length === 0) {
    throw new Error('No Harness Profiles configured; add a "harnesses" map to incubator.config.json');
  }
  const listing = `Configured Harness Profiles: ${names.map((n) => `"${n}"`).join(", ")}`;

  const name = flagValue(argv, "--harness", `--harness requires a profile name. ${listing}`) ?? options.defaultName;
  if (!name) {
    throw new Error(`A Night Run requires --harness <name> (or a "harness" default on the profile). ${listing}`);
  }
  const config = harnesses[name];
  if (!config) {
    throw new Error(`Unknown Harness Profile "${name}". ${listing}`);
  }
  const kind = config.kind ?? "claude";
  if (!KINDS.includes(kind)) {
    throw new Error(`Harness Profile "${name}": kind must be one of ${KINDS.join(", ")}, got "${String(kind)}"`);
  }
  if (kind === "custom" && !config.command) {
    throw new Error(`Harness Profile "${name}": kind "custom" needs a command`);
  }
  if (config.args && !config.args.includes("{prompt}")) {
    throw new Error(`Harness Profile "${name}": args must contain "{prompt}" or the session gets no Brief`);
  }
  if (kind === "custom" && !config.args) {
    throw new Error(`Harness Profile "${name}": kind "custom" needs args (an argument template with "{prompt}")`);
  }
  const model = flagValue(argv, "--model", "--model requires a model name (e.g. claude-opus-5)") ?? config.model ?? null;
  return {
    name,
    kind,
    command: expandHome(config.command ?? kind),
    env: Object.fromEntries(Object.entries(config.env ?? {}).map(([key, value]) => [key, expandHome(value)])),
    model,
    args: config.args ?? null,
  };
}
