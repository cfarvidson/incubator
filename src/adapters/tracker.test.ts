import { afterEach, describe, expect, it, vi } from "vitest";
import { githubSessionHints } from "./github.js";
import { linearSessionHints } from "./linear.js";
import { makeTracker } from "./tracker.js";

afterEach(() => vi.unstubAllEnvs());

describe("makeTracker", () => {
  it("pairs the github adapter with the gh comment hints", () => {
    const { tracker, sessionHints } = makeTracker({ kind: "github", scope: ["cfarvidson"] });
    expect(sessionHints).toBe(githubSessionHints);
    expect(typeof tracker.checkAuth).toBe("function");
  });

  it("pairs the linear adapter with the MCP comment hints", () => {
    vi.stubEnv("LINEAR_API_KEY", "test-key");
    const { tracker, sessionHints } = makeTracker({ kind: "linear" });
    expect(sessionHints).toBe(linearSessionHints);
    expect(typeof tracker.checkAuth).toBe("function");
  });
});
