import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveHarnessProfile, type HarnessConfig } from "./harness.js";

const HARNESSES: Record<string, HarnessConfig> = {
  dclaude: { kind: "claude" },
  wclaude: { kind: "claude", env: { CLAUDE_CONFIG_DIR: "~/.claude-work" } },
  wcodex: { kind: "codex", command: "wcodex" },
  grok: { kind: "custom", command: "grok", args: ["-p", "{prompt}"] },
};

describe("resolveHarnessProfile", () => {
  it("resolves a named claude profile with env and the kind's default command", () => {
    expect(resolveHarnessProfile(["--run", "--harness", "wclaude"], HARNESSES, { required: true })).toEqual({
      name: "wclaude",
      kind: "claude",
      command: "claude",
      env: { CLAUDE_CONFIG_DIR: join(homedir(), ".claude-work") },
      model: null,
      args: null,
    });
  });

  it("defaults kind to claude when omitted", () => {
    expect(resolveHarnessProfile(["--harness", "bare"], { bare: {} }, { required: true })).toEqual({
      name: "bare",
      kind: "claude",
      command: "claude",
      env: {},
      model: null,
      args: null,
    });
  });

  it("resolves a codex profile with its own command", () => {
    const profile = resolveHarnessProfile(["--harness", "wcodex"], HARNESSES, { required: true });
    expect(profile).toMatchObject({ kind: "codex", command: "wcodex" });
  });

  it("defaults a codex profile's command to codex", () => {
    const profile = resolveHarnessProfile(["--harness", "x"], { x: { kind: "codex" } }, { required: true });
    expect(profile?.command).toBe("codex");
  });

  it("resolves a custom profile carrying its args template", () => {
    const profile = resolveHarnessProfile(["--harness", "grok"], HARNESSES, { required: true });
    expect(profile).toMatchObject({ kind: "custom", command: "grok", args: ["-p", "{prompt}"] });
  });

  it("refuses a custom profile without command or args, and any args without {prompt}", () => {
    expect(() =>
      resolveHarnessProfile(["--harness", "x"], { x: { kind: "custom", args: ["{prompt}"] } }, { required: true }),
    ).toThrow('kind "custom" needs a command');
    expect(() =>
      resolveHarnessProfile(["--harness", "x"], { x: { kind: "custom", command: "grok" } }, { required: true }),
    ).toThrow('kind "custom" needs args');
    expect(() =>
      resolveHarnessProfile(["--harness", "x"], { x: { command: "c", args: ["-p"] } }, { required: true }),
    ).toThrow('args must contain "{prompt}"');
  });

  it("takes the model from the profile, and lets --model override it for the run", () => {
    const configured = { opus: { kind: "claude", model: "claude-opus-5" } } as Record<string, HarnessConfig>;
    expect(resolveHarnessProfile(["--harness", "opus"], configured, { required: true })?.model).toBe("claude-opus-5");
    expect(
      resolveHarnessProfile(["--harness", "opus", "--model", "claude-fable-5"], configured, { required: true })?.model,
    ).toBe("claude-fable-5");
    expect(
      resolveHarnessProfile(["--harness", "dclaude", "--model", "claude-opus-5"], HARNESSES, { required: true })?.model,
    ).toBe("claude-opus-5");
    expect(() => resolveHarnessProfile(["--harness", "dclaude", "--model"], HARNESSES, { required: true })).toThrow(
      "--model requires a model name",
    );
  });

  it("refuses a model that an args template cannot receive, and a {model} slot with no model", () => {
    const templated: Record<string, HarnessConfig> = {
      grok: { kind: "custom", command: "grok", model: "grok-5", args: ["-p", "{prompt}"] },
    };
    expect(() => resolveHarnessProfile(["--harness", "grok"], templated, { required: true })).toThrow(
      'no "{model}" slot',
    );
    const slotted: Record<string, HarnessConfig> = {
      grok: { kind: "custom", command: "grok", args: ["-m", "{model}", "-p", "{prompt}"] },
    };
    expect(() => resolveHarnessProfile(["--harness", "grok"], slotted, { required: true })).toThrow(
      "no model is set",
    );
    // With the slot and a model (config or --model), both resolve.
    expect(
      resolveHarnessProfile(["--harness", "grok", "--model", "grok-5"], slotted, { required: true })?.model,
    ).toBe("grok-5");
  });

  it("keeps a custom command and expands its ~/ prefix", () => {
    const harnesses = { wrapped: { command: "~/bin/claude-work" } };
    expect(resolveHarnessProfile(["--harness", "wrapped"], harnesses, { required: true })?.command).toBe(
      join(homedir(), "bin/claude-work"),
    );
  });

  it("leaves env values without a ~/ prefix verbatim", () => {
    const harnesses = { proxied: { env: { ANTHROPIC_BASE_URL: "http://localhost:8317" } } };
    expect(resolveHarnessProfile(["--harness", "proxied"], harnesses, { required: true })?.env).toEqual({
      ANTHROPIC_BASE_URL: "http://localhost:8317",
    });
  });

  it("refuses a required run without --harness or a profile default, listing the configured profiles", () => {
    expect(() => resolveHarnessProfile(["--run"], HARNESSES, { required: true })).toThrow(
      'A Night Run requires --harness <name> (or a "harness" default on the profile).',
    );
  });

  it("falls back to the Tracker Profile's default when --harness is omitted", () => {
    expect(resolveHarnessProfile(["--run"], HARNESSES, { required: true, defaultName: "dclaude" })?.name).toBe(
      "dclaude",
    );
    // Also on a dry run, so the Plan header shows the harness the night would use.
    expect(resolveHarnessProfile([], HARNESSES, { required: false, defaultName: "dclaude" })?.name).toBe("dclaude");
  });

  it("lets --harness outrank the Tracker Profile's default", () => {
    expect(
      resolveHarnessProfile(["--harness", "wclaude"], HARNESSES, { required: true, defaultName: "dclaude" })?.name,
    ).toBe("wclaude");
  });

  it("refuses an unknown profile name, listing the configured profiles", () => {
    expect(() => resolveHarnessProfile(["--harness", "xclaude"], HARNESSES, { required: true })).toThrow(
      'Unknown Harness Profile "xclaude".',
    );
  });

  it("refuses --harness without a name", () => {
    expect(() => resolveHarnessProfile(["--harness"], HARNESSES, { required: true })).toThrow(
      "--harness requires a profile name",
    );
    expect(() => resolveHarnessProfile(["--harness", "--run"], HARNESSES, { required: true })).toThrow(
      "--harness requires a profile name",
    );
  });

  it("refuses a required run when no profiles are configured, pointing at the config file", () => {
    expect(() => resolveHarnessProfile(["--run"], {}, { required: true })).toThrow(
      'No Harness Profiles configured; add a "harnesses" map to incubator.config.json',
    );
  });

  it("returns null when not required and no --harness is given", () => {
    expect(resolveHarnessProfile(["--dry-run"], HARNESSES, { required: false })).toBeNull();
  });

  it("still validates a --harness given when not required", () => {
    expect(resolveHarnessProfile(["--dry-run", "--harness", "dclaude"], HARNESSES, { required: false })?.name).toBe(
      "dclaude",
    );
    expect(() => resolveHarnessProfile(["--dry-run", "--harness", "xclaude"], HARNESSES, { required: false })).toThrow(
      'Unknown Harness Profile "xclaude"',
    );
  });
});
