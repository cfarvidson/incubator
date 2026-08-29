import { EventEmitter } from "node:events";
import type { spawn } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeProcessSupervisor, type SuperviseOptions } from "./supervised-process.js";

/**
 * A stand-in child process. `pid` stays undefined so the group kill
 * (process.kill(-pid)) throws and falls back to child.kill, which records
 * the signal - no real signal ever leaves the test.
 */
class FakeChild extends EventEmitter {
  pid = undefined;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kills: string[] = [];
  kill(signal: string): boolean {
    this.kills.push(signal);
    return true;
  }
}

function harness(options: Partial<SuperviseOptions> = {}) {
  const child = new FakeChild();
  const spawns: { command: string; args: string[]; options: Record<string, unknown> }[] = [];
  const spawnFn = ((command: string, args: string[], spawnOptions: Record<string, unknown>) => {
    spawns.push({ command, args, options: spawnOptions });
    return child;
  }) as unknown as typeof spawn;
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  const interrupts: number[] = [];
  const ended = makeProcessSupervisor(spawnFn).run("claude", ["-p", "the prompt"], {
    cwd: "/worktrees/example-cfa-1",
    env: { PATH: "/usr/bin" },
    capMs: 60_000,
    onStdout: (chunk) => stdout.push(chunk),
    onStderr: (chunk) => stderr.push(chunk),
    onInterrupt: () => interrupts.push(1),
    ...options,
  });
  return { child, spawns, stdout, stderr, interrupts, ended };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("makeProcessSupervisor", () => {
  it("spawns detached in the given cwd and reports a clean exit with the output tail", async () => {
    const { child, spawns, stdout, stderr, ended } = harness();
    child.stdout.emit("data", Buffer.from("working\n"));
    child.stderr.emit("data", Buffer.from("a warning\n"));
    child.emit("exit", 0, null);

    expect(await ended).toEqual({
      timedOut: false,
      interrupted: false,
      status: 0,
      signal: null,
      outputTail: "working\na warning\n",
    });
    expect(spawns).toEqual([
      {
        command: "claude",
        args: ["-p", "the prompt"],
        options: expect.objectContaining({ cwd: "/worktrees/example-cfa-1", detached: true }),
      },
    ]);
    expect(stdout.map(String)).toEqual(["working\n"]);
    expect(stderr.map(String)).toEqual(["a warning\n"]);
  });

  it("stops the group with SIGTERM at the Duration Cap, escalating to SIGKILL after 10s", async () => {
    vi.useFakeTimers();
    const { child, ended } = harness({ capMs: 60_000 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(child.kills).toEqual(["SIGTERM"]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(child.kills).toEqual(["SIGTERM", "SIGKILL"]);
    child.emit("exit", null, "SIGKILL");

    expect(await ended).toMatchObject({ timedOut: true, interrupted: false, status: null, signal: "SIGKILL" });
  });

  it("reports Ctrl+C as a value - stop the group, tell the caller, never process.exit", async () => {
    const { child, interrupts, ended } = harness();
    const listenersBefore = process.listeners("SIGINT").length;
    process.emit("SIGINT");
    expect(interrupts).toEqual([1]);
    expect(child.kills).toEqual(["SIGTERM"]);
    child.emit("exit", null, "SIGTERM");

    expect(await ended).toMatchObject({ interrupted: true, timedOut: false, signal: "SIGTERM" });
    expect(process.listeners("SIGINT").length).toBe(listenersBefore - 1);
  });

  it("keeps a multi-byte character split across chunk edges intact in the tail", async () => {
    const { child, ended } = harness();
    const bytes = Buffer.from("för många förfrågningar", "utf8");
    child.stdout.emit("data", bytes.subarray(0, 2)); // splits the first ö
    child.stdout.emit("data", bytes.subarray(2));
    child.emit("exit", 1, null);

    const end = await ended;
    expect(end.outputTail).toBe("för många förfrågningar");
    expect(end.outputTail).not.toContain("�");
  });

  it("keeps only the last 8192 characters of output in the tail", async () => {
    const { child, ended } = harness();
    child.stdout.emit("data", Buffer.from("x".repeat(9000)));
    child.emit("exit", 1, null);

    expect((await ended).outputTail).toHaveLength(8192);
  });

  it("rejects when the command cannot be spawned", async () => {
    const { child, ended } = harness();
    child.emit("error", new Error("spawn claude ENOENT"));

    await expect(ended).rejects.toThrow("ENOENT");
  });
});
