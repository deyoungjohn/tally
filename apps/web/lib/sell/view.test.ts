import { describe, expect, it } from "vitest";
import { explainSellError } from "./view";

describe("explainSellError: wallet refusals keep their plain message", () => {
  it("shows the not-enough-BNB message instead of a generic failure", () => {
    const e = Object.assign(new Error("You don't have enough BNB to pay the network fee."), {
      kind: "needs_gas",
    });
    expect(explainSellError(e)).toEqual({
      kind: "failed",
      message: "You don't have enough BNB to pay the network fee.",
    });
  });
});
