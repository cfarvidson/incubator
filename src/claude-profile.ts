import { homedir } from "node:os";
import { join } from "node:path";

/** A Claude Profile as written in incubator.config.json under `claudes`. */
export interface ClaudeProfileConfig {
  /** Layered over the Runner's own environment when spawning Card Sessions. */
  env?: Record<string, string>;
  /** The executable to spawn; defaults to `claude` on PATH. */
  command?: string;
}

/** A resolved Claude Profile: which claude (credentials) this Night Run's Card Sessions use. */
export interface ClaudeProfile {
  name: string;
  command: string;
  env: Record<string, string>;
}

/** Only `~/`-prefixed values are paths to expand; anything else (commands on PATH, tokens, URLs) stays verbatim. */
function expandHome(value: string): string {
  return value.startsWith("~/") ? join(homedir(), value.slice(2)) : value;
}

/**
 * Picks the Claude Profile named by `--claude <name>`. Required for a real run
 * (fail-fast, before any Linear reads or writes); a dry run may omit it but a
 * given name is still validated. Returns null only when omitted and not required.
 */
export function resolveClaudeProfile(
  argv: string[],
  claudes: Record<string, ClaudeProfileConfig>,
  options: { required: boolean },
): ClaudeProfile | null {
  const flagIndex = argv.indexOf("--claude");
  if (flagIndex === -1 && !options.required) return null;

  const names = Object.keys(claudes);
  if (names.length === 0) {
    throw new Error('No Claude Profiles configured; add a "claudes" map to incubator.config.json');
  }
  const listing = `Configured Claude Profiles: ${names.map((n) => `"${n}"`).join(", ")}`;

  if (flagIndex === -1) {
    throw new Error(`A Night Run requires --claude <name>. ${listing}`);
  }
  const name = argv[flagIndex + 1];
  if (!name || name.startsWith("-")) {
    throw new Error(`--claude requires a profile name. ${listing}`);
  }
  const config = claudes[name];
  if (!config) {
    throw new Error(`Unknown Claude Profile "${name}". ${listing}`);
  }
  return {
    name,
    command: expandHome(config.command ?? "claude"),
    env: Object.fromEntries(Object.entries(config.env ?? {}).map(([key, value]) => [key, expandHome(value)])),
  };
}
