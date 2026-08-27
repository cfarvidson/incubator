import { describe, expect, it } from "vitest";
import { NIGHT_QUEUE_FILTER } from "./linear.js";

describe("NIGHT_QUEUE_FILTER", () => {
  it("encodes ADR-0002: assigned to me + Todo + label ready-for-agent, no team filter", () => {
    expect(NIGHT_QUEUE_FILTER).toEqual({
      assignee: { isMe: { eq: true } },
      state: { name: { eq: "Todo" } },
      labels: { name: { eq: "ready-for-agent" } },
    });
  });
});
