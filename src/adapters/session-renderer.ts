import { formatDuration } from "../core/report.js";

/** Collapses a tool input to one short line: the command/path if there is one, raw JSON otherwise. */
function summarizeToolInput(input: unknown): string {
  const record = (input ?? {}) as Record<string, unknown>;
  const summary =
    typeof record.command === "string"
      ? record.command
      : typeof record.file_path === "string"
        ? record.file_path
        : JSON.stringify(record);
  const oneLine = summary.replace(/\s*\n\s*/g, " ");
  return oneLine.length > 200 ? `${oneLine.slice(0, 200)}...` : oneLine;
}

/**
 * Progress lines for one stream-json event, so the terminal shows the session
 * working instead of hours of silence (which reads as a hang and invites the
 * Ctrl+C that orphaned the sessions of 2026-08-27). Returns [] for events not
 * worth a line (tool results and other chatter).
 */
export function renderSessionEvent(event: unknown): string[] {
  if (typeof event !== "object" || event === null) return [];
  const e = event as Record<string, any>;
  if (e.type === "system" && e.subtype === "init") {
    return [`Card Session started (model ${e.model ?? "unknown"})`];
  }
  if (e.type === "assistant") {
    const lines: string[] = [];
    for (const block of e.message?.content ?? []) {
      if (block.type === "text" && block.text.trim() !== "") lines.push(block.text);
      if (block.type === "tool_use") lines.push(`> ${block.name}: ${summarizeToolInput(block.input)}`);
    }
    return lines;
  }
  if (e.type === "result") {
    const outcome = e.is_error ? `failed (${e.subtype})` : "finished";
    const duration = typeof e.duration_ms === "number" ? ` in ${formatDuration(e.duration_ms)}` : "";
    const lines = [`Card Session ${outcome}${duration}`];
    // On success the result text duplicates the already-streamed final assistant message.
    if (e.is_error && typeof e.result === "string" && e.result.trim() !== "") lines.push(e.result);
    return lines;
  }
  return [];
}

function printStamped(line: string): void {
  console.log(`[${new Date().toLocaleTimeString("sv-SE")}] ${line}`);
}

export interface SessionRenderer {
  /** One raw stdout chunk; complete lines are rendered and printed, the rest buffered. */
  feed(chunk: Buffer): void;
  /** Session over: flush the trailing partial line so a killed session still shows its last words. */
  end(): void;
}

/**
 * Turns a Card Session's raw stdout chunks into printed progress lines. Chunks
 * are decoded with a streaming TextDecoder, so a multi-byte character split
 * across chunk edges survives instead of becoming U+FFFD noise.
 */
export function makeSessionRenderer(print: (line: string) => void = printStamped): SessionRenderer {
  const decoder = new TextDecoder();
  let lineBuffer = "";
  const printLine = (rawLine: string) => {
    if (rawLine.trim() === "") return;
    let lines: string[];
    try {
      lines = renderSessionEvent(JSON.parse(rawLine));
    } catch {
      lines = [rawLine]; // not stream-json (unexpected CLI output): show it untouched
    }
    for (const line of lines) print(line);
  };
  return {
    feed(chunk: Buffer): void {
      lineBuffer += decoder.decode(chunk, { stream: true });
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop()!;
      for (const line of lines) printLine(line);
    },
    end(): void {
      lineBuffer += decoder.decode();
      printLine(lineBuffer);
      lineBuffer = "";
    },
  };
}
