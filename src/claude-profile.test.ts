import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveClaudeProfile } from "./claude-profile.js";

const CLAUDES = {
  dclaude: {},
  wclaude: { env: { CLAUDE_CONFIG_DIR: "~/.claude-work" } },
};

describe("resolveClaudeProfile", () => {
  it("resolves a named profile with env and the default claude command", () => {
    expect(resolveClaudeProfile(["--run", "--claude", "wclaude"], CLAUDES, { required: true })).toEqual({
      name: "wclaude",
      command: "claude",
      env: { CLAUDE_CONFIG_DIR: join(homedir(), ".claude-work") },
    });
  });

  it("resolves a profile with no env to the bare default command", () => {
    expect(resolveClaudeProfile(["--claude", "dclaude"], CLAUDES, { required: true })).toEqual({
      name: "dclaude",
      command: "claude",
      env: {},
    });
  });

  it("keeps a custom command and expands its ~/ prefix", () => {
    const claudes = { wrapped: { command: "~/bin/claude-work" } };
    expect(resolveClaudeProfile(["--claude", "wrapped"], claudes, { required: true })).toEqual({
      name: "wrapped",
      command: join(homedir(), "bin/claude-work"),
      env: {},
    });
  });

  it("leaves env values without a ~/ prefix verbatim", () => {
    const claudes = { proxied: { env: { ANTHROPIC_BASE_URL: "http://localhost:8317" } } };
    expect(resolveClaudeProfile(["--claude", "proxied"], claudes, { required: true })?.env).toEqual({
      ANTHROPIC_BASE_URL: "http://localhost:8317",
    });
  });

  it("refuses a required run without --claude, listing the configured profiles", () => {
    expect(() => resolveClaudeProfile(["--run"], CLAUDES, { required: true })).toThrow(
      'A Night Run requires --claude <name>. Configured Claude Profiles: "dclaude", "wclaude"',
    );
  });

  it("refuses an unknown profile name, listing the configured profiles", () => {
    expect(() => resolveClaudeProfile(["--claude", "xclaude"], CLAUDES, { required: true })).toThrow(
      'Unknown Claude Profile "xclaude". Configured Claude Profiles: "dclaude", "wclaude"',
    );
  });

  it("refuses --claude without a name", () => {
    expect(() => resolveClaudeProfile(["--claude"], CLAUDES, { required: true })).toThrow(
      "--claude requires a profile name",
    );
    expect(() => resolveClaudeProfile(["--claude", "--run"], CLAUDES, { required: true })).toThrow(
      "--claude requires a profile name",
    );
  });

  it("refuses a required run when no profiles are configured, pointing at the config file", () => {
    expect(() => resolveClaudeProfile(["--run"], {}, { required: true })).toThrow(
      'No Claude Profiles configured; add a "claudes" map to incubator.config.json',
    );
    expect(() => resolveClaudeProfile(["--claude", "dclaude"], {}, { required: true })).toThrow(
      'No Claude Profiles configured; add a "claudes" map to incubator.config.json',
    );
  });

  it("returns null when not required and no --claude is given", () => {
    expect(resolveClaudeProfile(["--dry-run"], CLAUDES, { required: false })).toBeNull();
  });

  it("still validates a --claude given when not required", () => {
    expect(resolveClaudeProfile(["--dry-run", "--claude", "dclaude"], CLAUDES, { required: false })?.name).toBe(
      "dclaude",
    );
    expect(() => resolveClaudeProfile(["--dry-run", "--claude", "xclaude"], CLAUDES, { required: false })).toThrow(
      'Unknown Claude Profile "xclaude"',
    );
  });
});
