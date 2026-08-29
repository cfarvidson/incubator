import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const dirs: string[] = [];

function configFile(config: object): string {
  const dir = mkdtempSync(join(tmpdir(), "config-"));
  dirs.push(dir);
  const path = join(dir, "incubator.config.json");
  writeFileSync(path, JSON.stringify(config));
  return path;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("loads a valid config and fills the defaults", () => {
    const config = loadConfig(configFile({ cloneRoots: ["/tmp/clones"] }));
    expect(config).toEqual({
      cloneRoots: ["/tmp/clones"],
      durationCapMinutes: 120,
      stopTime: "07:00",
      model: null,
      claudes: {},
    });
  });

  it("expands ~/ in cloneRoots and keeps explicit values", () => {
    const config = loadConfig(
      configFile({
        cloneRoots: ["~/code"],
        durationCapMinutes: 45,
        stopTime: "06:30",
        model: "claude-sonnet-5",
        claudes: { wclaude: { env: { CLAUDE_CONFIG_DIR: "~/.claude-work" } } },
      }),
    );
    expect(config.cloneRoots[0]).not.toContain("~");
    expect(config.cloneRoots[0]).toMatch(/\/code$/);
    expect(config.durationCapMinutes).toBe(45);
    expect(config.stopTime).toBe("06:30");
    expect(config.model).toBe("claude-sonnet-5");
    expect(config.claudes).toEqual({ wclaude: { env: { CLAUDE_CONFIG_DIR: "~/.claude-work" } } });
  });

  it("rejects a malformed stopTime", () => {
    expect(() => loadConfig(configFile({ cloneRoots: ["/tmp/clones"], stopTime: "25:00" }))).toThrowError(/HH:MM/);
  });

  it("rejects a config without cloneRoots", () => {
    expect(() => loadConfig(configFile({ stopTime: "07:00" }))).toThrowError(/cloneRoots/);
  });
});
