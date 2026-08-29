import { describe, expect, it } from "vitest";
import { CLAIM_COMMENT, isStranded, NIGHT_QUEUE_FILTER, swapLabelsForBounce } from "./linear.js";

describe("NIGHT_QUEUE_FILTER", () => {
  it("encodes ADR-0002: assigned to me + Todo + label ready-for-agent, no team filter", () => {
    expect(NIGHT_QUEUE_FILTER).toEqual({
      assignee: { isMe: { eq: true } },
      state: { name: { eq: "Todo" } },
      labels: { name: { eq: "ready-for-agent" } },
    });
  });
});

describe("isStranded", () => {
  it("marks a Card whose latest Night Run comment is a Claim", () => {
    expect(isStranded([CLAIM_COMMENT])).toBe(true);
  });

  it("clears a Card whose Claim is followed by a terminal result", () => {
    expect(isStranded([CLAIM_COMMENT, "Night Run result: done.\n\n- https://github.com/x/y/pull/1"])).toBe(false);
    expect(isStranded([CLAIM_COMMENT, "Night Run result: Bounced.\n\nreason"])).toBe(false);
  });

  it("marks a re-Claimed Card whose second run also died", () => {
    expect(isStranded([CLAIM_COMMENT, "Night Run result: Bounced.\n\nreason", CLAIM_COMMENT])).toBe(true);
  });

  it("ignores human comments: they neither strand nor resolve", () => {
    expect(isStranded(["ser bra ut!", "kolla imorgon"])).toBe(false);
    expect(isStranded([CLAIM_COMMENT, "jag tittar på detta imorgon"])).toBe(true);
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
