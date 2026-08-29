import { homedir } from "node:os";
import { join } from "node:path";

/** Only `~/`-prefixed values are paths to expand; anything else (commands on PATH, tokens, URLs) stays verbatim. */
export function expandHome(value: string): string {
  return value.startsWith("~/") ? join(homedir(), value.slice(2)) : value;
}
