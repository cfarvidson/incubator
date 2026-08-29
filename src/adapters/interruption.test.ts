import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { makeInterruptionWatcher } from "./interruption.js";

describe("makeInterruptionWatcher", () => {
  it("reports no interruption before any SIGINT", () => {
    const watcher = makeInterruptionWatcher(new EventEmitter());
    expect(watcher.interrupted()).toBe(false);
  });

  it("flips to interrupted and resolves whenInterrupted on SIGINT", async () => {
    const signals = new EventEmitter();
    const watcher = makeInterruptionWatcher(signals);
    const when = watcher.whenInterrupted();
    signals.emit("SIGINT");
    expect(watcher.interrupted()).toBe(true);
    await expect(when).resolves.toBeUndefined();
  });

  it("stays interrupted across repeated SIGINTs", async () => {
    const signals = new EventEmitter();
    const watcher = makeInterruptionWatcher(signals);
    signals.emit("SIGINT");
    signals.emit("SIGINT");
    expect(watcher.interrupted()).toBe(true);
    await watcher.whenInterrupted();
  });
});
