import { describe, expect, it } from "vitest";
import { renderSessionEvent } from "./executor.js";

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
