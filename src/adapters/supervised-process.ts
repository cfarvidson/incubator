import { spawn } from "node:child_process";

/** How a supervised process ended; every way out is a value, never a process.exit. */
export interface ProcessEnd {
  /** The process hit the Duration Cap and was stopped. */
  timedOut: boolean;
  /** Ctrl+C: the caller Bounces the in-flight Card and lands the Morning Report; cli.ts exits 130. */
  interrupted: boolean;
  status: number | null;
  signal: NodeJS.Signals | null;
  /** The tail of the combined decoded output, for rate-limit detection on a failed session. */
  outputTail: string;
}

export interface SuperviseOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** The Duration Cap in ms: past it the whole process group is stopped. */
  capMs: number;
  onStdout: (chunk: Buffer) => void;
  onStderr: (chunk: Buffer) => void;
  onInterrupt: () => void;
}

export interface ProcessSupervisor {
  /** Runs the command in the cwd under the Duration Cap and reports how it ended. */
  run(command: string, args: string[], options: SuperviseOptions): Promise<ProcessEnd>;
}

/** A session ignoring SIGTERM must not hang the whole Night Run. */
const SIGKILL_DELAY_MS = 10_000;

/**
 * Spawns the process detached as its own process group so the Duration Cap
 * can stop the whole tree (claude plus any builds/tests it spawned), not
 * just the claude process itself. The flip side of detaching is that Ctrl+C
 * no longer reaches the session, so SIGINT is forwarded explicitly: the
 * group is stopped and the interruption is reported as a value, so the run
 * can Bounce the Card and land the Morning Report before exiting.
 */
export function makeProcessSupervisor(spawnProcess: typeof spawn = spawn): ProcessSupervisor {
  return {
    run(command, args, options) {
      return new Promise((resolve, reject) => {
        const child = spawnProcess(command, args, {
          cwd: options.cwd,
          env: options.env,
          stdio: ["inherit", "pipe", "pipe"],
          detached: true,
        });
        // One streaming decoder per stream: a multi-byte character split across
        // chunk edges survives into the tail instead of becoming U+FFFD noise.
        let outputTail = "";
        const keepTail = (decoder: TextDecoder) => (chunk: Buffer) => {
          outputTail = (outputTail + decoder.decode(chunk, { stream: true })).slice(-8192);
        };
        const stdoutTail = keepTail(new TextDecoder());
        const stderrTail = keepTail(new TextDecoder());
        child.stdout!.on("data", (chunk: Buffer) => {
          stdoutTail(chunk);
          options.onStdout(chunk);
        });
        child.stderr!.on("data", (chunk: Buffer) => {
          stderrTail(chunk);
          options.onStderr(chunk);
        });
        let timedOut = false;
        let interrupted = false;
        let killTimer: NodeJS.Timeout | undefined;
        const killGroup = (signal: NodeJS.Signals) => {
          try {
            process.kill(-child.pid!, signal);
          } catch {
            child.kill(signal);
          }
        };
        const stopGroup = () => {
          killGroup("SIGTERM");
          killTimer = setTimeout(() => killGroup("SIGKILL"), SIGKILL_DELAY_MS);
        };
        const onSigint = () => {
          interrupted = true;
          options.onInterrupt();
          stopGroup();
        };
        process.once("SIGINT", onSigint);
        const timer = setTimeout(() => {
          timedOut = true;
          stopGroup();
        }, options.capMs);
        child.once("error", (error) => {
          clearTimeout(timer);
          clearTimeout(killTimer);
          process.removeListener("SIGINT", onSigint);
          reject(error);
        });
        child.once("exit", (status, signal) => {
          clearTimeout(timer);
          clearTimeout(killTimer);
          process.removeListener("SIGINT", onSigint);
          resolve({ timedOut, interrupted, status, signal, outputTail });
        });
      });
    },
  };
}
