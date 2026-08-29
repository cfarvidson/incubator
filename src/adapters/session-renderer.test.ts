import { describe, expect, it } from "vitest";
import { makeSessionRenderer, renderSessionEvent } from "./session-renderer.js";

describe("renderSessionEvent", () => {
  it("announces the session start on the init event", () => {
    expect(renderSessionEvent({ type: "system", subtype: "init", model: "claude-sonnet-5" })).toEqual([
      "Card Session started (model claude-sonnet-5)",
    ]);
  });

  it("renders assistant text and tool calls, one line each", () => {
    const event = {
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Reading the Dockerfile first." },
          { type: "tool_use", name: "Bash", input: { command: "git log --oneline" } },
          { type: "tool_use", name: "Edit", input: { file_path: "node/abr-encore/Dockerfile", old_string: "x" } },
        ],
      },
    };
    expect(renderSessionEvent(event)).toEqual([
      "Reading the Dockerfile first.",
      "> Bash: git log --oneline",
      "> Edit: node/abr-encore/Dockerfile",
    ]);
  });

  it("collapses multi-line tool commands to one truncated line", () => {
    const event = {
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Bash", input: { command: `echo a\n${"x".repeat(300)}` } }],
      },
    };
    const [line] = renderSessionEvent(event);
    expect(line).not.toContain("\n");
    expect(line!.length).toBeLessThanOrEqual("> Bash: ".length + 203);
    expect(line).toContain("echo a x");
  });

  it("renders the result event with outcome and duration, without repeating the streamed final text", () => {
    const event = { type: "result", subtype: "success", is_error: false, duration_ms: 7_260_000, result: "PR created." };
    expect(renderSessionEvent(event)).toEqual(["Card Session finished in 2h 01m"]);
  });

  it("marks an error result as failed and shows its error text", () => {
    const event = { type: "result", subtype: "error_during_execution", is_error: true, result: "boom" };
    expect(renderSessionEvent(event)).toEqual(["Card Session failed (error_during_execution)", "boom"]);
  });

  it("stays silent on tool results and non-events", () => {
    expect(renderSessionEvent({ type: "user", message: { content: [] } })).toEqual([]);
    expect(renderSessionEvent("not an object")).toEqual([]);
    expect(renderSessionEvent(null)).toEqual([]);
  });
});

function collectingRenderer() {
  const printed: string[] = [];
  const renderer = makeSessionRenderer((line) => printed.push(line));
  return { renderer, printed };
}

describe("makeSessionRenderer", () => {
  it("renders one stream-json event per line, buffering lines across chunk edges", () => {
    const { renderer, printed } = collectingRenderer();
    const event = JSON.stringify({ type: "system", subtype: "init", model: "claude-sonnet-5" });
    renderer.feed(Buffer.from(event.slice(0, 10)));
    expect(printed).toEqual([]);
    renderer.feed(Buffer.from(`${event.slice(10)}\n`));

    expect(printed).toEqual(["Card Session started (model claude-sonnet-5)"]);
  });

  it("shows non-JSON output untouched and skips blank lines", () => {
    const { renderer, printed } = collectingRenderer();
    renderer.feed(Buffer.from("plain stderr-ish noise\n\n"));

    expect(printed).toEqual(["plain stderr-ish noise"]);
  });

  it("flushes the trailing partial line at session end", () => {
    const { renderer, printed } = collectingRenderer();
    renderer.feed(Buffer.from("killed mid-sente"));
    expect(printed).toEqual([]);
    renderer.end();

    expect(printed).toEqual(["killed mid-sente"]);
  });

  it("prints nothing extra at end when the output ended on a newline", () => {
    const { renderer, printed } = collectingRenderer();
    renderer.feed(Buffer.from("done\n"));
    renderer.end();

    expect(printed).toEqual(["done"]);
  });

  it("survives a multi-byte character split across chunk edges", () => {
    const { renderer, printed } = collectingRenderer();
    const bytes = Buffer.from("förfrågan\n", "utf8");
    renderer.feed(bytes.subarray(0, 2)); // splits the ö
    renderer.feed(bytes.subarray(2));

    expect(printed).toEqual(["förfrågan"]);
    expect(printed[0]).not.toContain("�");
  });

  it("flushes an incomplete multi-byte character as replacement, never dropping the line", () => {
    const { renderer, printed } = collectingRenderer();
    renderer.feed(Buffer.from([0x74, 0x61, 0x69, 0x6c, 0xc3])); // "tail" + first byte of ö
    renderer.end();

    expect(printed).toEqual(["tail�"]);
  });
});
