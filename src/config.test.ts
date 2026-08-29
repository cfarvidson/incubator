import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig, resolveTrackerProfile } from "./config.js";

const dirs: string[] = [];

function configFile(config: object): string {
  const dir = mkdtempSync(join(tmpdir(), "config-"));
  dirs.push(dir);
  const path = join(dir, "incubator.config.json");
  writeFileSync(path, JSON.stringify(config));
  return path;
}

const WORK_PROFILE = { tracker: { kind: "linear" }, cloneRoots: ["/tmp/clones"] };

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("loads a valid config and fills the defaults", () => {
    const config = loadConfig(configFile({ profiles: { work: WORK_PROFILE } }));
    expect(config).toEqual({
      durationCapMinutes: 120,
      stopTime: "07:00",
      model: null,
      claudes: {},
      profiles: {
        work: { name: "work", tracker: { kind: "linear" }, cloneRoots: ["/tmp/clones"], claude: null },
      },
      defaultProfile: null,
    });
  });

  it("expands ~/ in cloneRoots and keeps explicit values", () => {
    const config = loadConfig(
      configFile({
        durationCapMinutes: 45,
        stopTime: "06:30",
        model: "claude-sonnet-5",
        claudes: { wclaude: { env: { CLAUDE_CONFIG_DIR: "~/.claude-work" } } },
        profiles: {
          work: { tracker: { kind: "linear" }, cloneRoots: ["~/code"], claude: "wclaude" },
          home: { tracker: { kind: "github", scope: ["cfarvidson"] }, cloneRoots: ["/clones"] },
        },
        defaultProfile: "work",
      }),
    );
    expect(config.profiles["work"]!.cloneRoots[0]).not.toContain("~");
    expect(config.profiles["work"]!.cloneRoots[0]).toMatch(/\/code$/);
    expect(config.profiles["work"]!.claude).toBe("wclaude");
    expect(config.profiles["home"]!.tracker).toEqual({ kind: "github", scope: ["cfarvidson"] });
    expect(config.defaultProfile).toBe("work");
    expect(config.durationCapMinutes).toBe(45);
    expect(config.stopTime).toBe("06:30");
    expect(config.model).toBe("claude-sonnet-5");
    expect(config.claudes).toEqual({ wclaude: { env: { CLAUDE_CONFIG_DIR: "~/.claude-work" } } });
  });

  it("rejects a malformed stopTime", () => {
    expect(() => loadConfig(configFile({ profiles: { work: WORK_PROFILE }, stopTime: "25:00" }))).toThrowError(/HH:MM/);
  });

  it("rejects a config without profiles", () => {
    expect(() => loadConfig(configFile({ stopTime: "07:00" }))).toThrowError(/profiles/);
  });

  it("rejects a profile without cloneRoots", () => {
    expect(() => loadConfig(configFile({ profiles: { work: { tracker: { kind: "linear" } } } }))).toThrowError(
      /Profile "work".*cloneRoots/,
    );
  });

  it("rejects an unknown tracker kind", () => {
    expect(() =>
      loadConfig(configFile({ profiles: { work: { tracker: { kind: "jira" }, cloneRoots: ["/c"] } } })),
    ).toThrowError(/tracker\.kind/);
  });

  it("rejects a github tracker without a scope", () => {
    expect(() =>
      loadConfig(configFile({ profiles: { home: { tracker: { kind: "github" }, cloneRoots: ["/c"] } } })),
    ).toThrowError(/scope/);
  });

  it("rejects a defaultProfile naming no profile", () => {
    expect(() =>
      loadConfig(configFile({ profiles: { work: WORK_PROFILE }, defaultProfile: "nope" })),
    ).toThrowError(/defaultProfile "nope"/);
  });
});

describe("resolveTrackerProfile", () => {
  function config(extra: object = {}) {
    return loadConfig(
      configFile({
        profiles: {
          work: WORK_PROFILE,
          home: { tracker: { kind: "github", scope: ["cfarvidson"] }, cloneRoots: ["/clones"] },
        },
        ...extra,
      }),
    );
  }

  it("picks the profile named by --profile", () => {
    expect(resolveTrackerProfile(["--profile", "home"], config()).name).toBe("home");
  });

  it("falls back to defaultProfile when --profile is omitted", () => {
    expect(resolveTrackerProfile([], config({ defaultProfile: "work" })).name).toBe("work");
  });

  it("uses the sole profile without needing defaultProfile", () => {
    const sole = loadConfig(configFile({ profiles: { work: WORK_PROFILE } }));
    expect(resolveTrackerProfile([], sole).name).toBe("work");
  });

  it("refuses to guess between profiles, listing them", () => {
    expect(() => resolveTrackerProfile([], config())).toThrowError(/--profile <name>.*"work", "home"/);
  });

  it("refuses an unknown or missing --profile name", () => {
    expect(() => resolveTrackerProfile(["--profile", "nope"], config())).toThrowError(/Unknown profile "nope"/);
    expect(() => resolveTrackerProfile(["--profile"], config())).toThrowError(/--profile requires/);
    expect(() => resolveTrackerProfile(["--profile", "--dry-run"], config())).toThrowError(/--profile requires/);
  });

  it("lets --profile outrank defaultProfile", () => {
    expect(resolveTrackerProfile(["--profile", "home"], config({ defaultProfile: "work" })).name).toBe("home");
  });
});
