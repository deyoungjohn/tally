import { describe, expect, it } from "vitest";
import { errorResponse } from "./http";

describe("errorResponse", () => {
  it("Binance's 'Insufficient liquidity' becomes a plain no-liquidity answer, not a server fault", async () => {
    const res = errorResponse(
      new Error(
        "Insufficient liquidity for a quote. Please decrease the transaction amount or try again later.",
      ),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: {
        kind: "no_liquidity",
        message: "There isn't enough liquidity on BNB Chain to trade this token right now.",
      },
    });
  });

  it("anything else unknown is still a generic 500", async () => {
    expect(errorResponse(new Error("boom")).status).toBe(500);
  });
});
