import { describe, expect, it } from "vitest";
import { CLAIM_COMMENT, isStranded } from "./claim-marker.js";

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
