import { describe, expect, it } from "vitest";
import { NIGHT_QUEUE_FILTER, swapLabelsForBounce } from "./linear.js";

describe("NIGHT_QUEUE_FILTER", () => {
  it("encodes ADR-0002/0003: assigned to me + Todo + label ready-for-agent, no team filter", () => {
    expect(NIGHT_QUEUE_FILTER).toEqual({
      assignee: { isMe: { eq: true } },
      state: { name: { eq: "Todo" } },
      labels: { name: { eq: "ready-for-agent" } },
    });
  });
});

describe("swapLabelsForBounce", () => {
  it("replaces ready-for-agent with the team's needs-info by name, keeping unrelated labels", () => {
    const swapped = swapLabelsForBounce(
      [
        { id: "label-rfa", name: "ready-for-agent" },
        { id: "label-bug", name: "bug" },
      ],
      [
        { id: "label-rfa", name: "ready-for-agent" },
        { id: "label-ni", name: "needs-info" },
      ],
    );
    expect(swapped).toEqual(["label-bug", "label-ni"]);
  });

  it("throws when the Card's own team has no needs-info label", () => {
    expect(() =>
      swapLabelsForBounce([{ id: "label-rfa", name: "ready-for-agent" }], [{ id: "label-rfa", name: "ready-for-agent" }]),
    ).toThrowError(/needs-info/);
  });
});
