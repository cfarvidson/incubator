import { describe, expect, it } from "vitest";
import { durationCapFromMinutes } from "./duration-cap.js";

describe("durationCapFromMinutes", () => {
  it("converts minutes to ms once, for every consumer", () => {
    expect(durationCapFromMinutes(120).ms).toBe(7_200_000);
  });

  it("renders whole hours as hour prose", () => {
    expect(durationCapFromMinutes(120).prose).toBe("2h");
    expect(durationCapFromMinutes(60).prose).toBe("1h");
  });

  it("renders partial hours as minutes, never '1.5h'", () => {
    expect(durationCapFromMinutes(90).prose).toBe("90m");
    expect(durationCapFromMinutes(45).prose).toBe("45m");
  });
});
