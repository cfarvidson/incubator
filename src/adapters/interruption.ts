import type { InterruptionPort } from "../core/types.js";

/**
 * Watches SIGINT for the whole night. The process supervisor covers Ctrl+C
 * while a Card Session runs; this watcher covers every other window
 * (planning, Linear writes, Backoff sleeps), where Node's default handler
 * would otherwise kill the run with no Bounce and no Morning Report.
 */
export function makeInterruptionWatcher(
  signals: { on(event: "SIGINT", listener: () => void): unknown } = process,
): InterruptionPort {
  let interrupted = false;
  let signal!: () => void;
  const when = new Promise<void>((resolve) => {
    signal = resolve;
  });
  signals.on("SIGINT", () => {
    interrupted = true;
    signal();
  });
  return { interrupted: () => interrupted, whenInterrupted: () => when };
}
