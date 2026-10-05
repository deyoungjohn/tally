import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import * as serverEngine from "../../../../lib/server/engine";

describe("/api/trade/sell route", () => {
  it("rejects invalid body without ticker or user", async () => {
    const req = new NextRequest("http://localhost:3000/api/trade/sell", {
      method: "POST",
      body: JSON.stringify({ ticker: "INVALID!!!" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.kind).toBe("invalid_request");
  });

  it("rejects unsupported tickers", async () => {
    const req = new NextRequest("http://localhost:3000/api/trade/sell", {
      method: "POST",
      body: JSON.stringify({
        ticker: "XYZ",
        issuer: "bstock",
        usd: 10,
        user: "0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error.kind).toBe("not_buyable");
  });

  it("calls engine.trade.prepareSell and returns the plan", async () => {
    const mockPlan = {
      status: "ready",
      builtAt: 12345,
      expiresAt: 27345,
      ticker: "NVDA",
      issuer: "bstock",
      symbol: "NVDAB",
      stock: "0x02fca66c1d1afb4e2a7884261eb00f63598a7436",
      tokensIn: "25654736000000000",
      sharesIn: "25674701000000000",
      quotedUsdtOut: "6000000000000000000",
      minUsdtOut: "5940000000000000000",
    };

    vi.spyOn(serverEngine, "getEngine").mockResolvedValue({
      trade: {
        prepareSell: vi.fn().mockResolvedValue(mockPlan),
      },
    } as unknown as Awaited<ReturnType<typeof serverEngine.getEngine>>);

    const req = new NextRequest("http://localhost:3000/api/trade/sell", {
      method: "POST",
      body: JSON.stringify({
        ticker: "NVDA",
        issuer: "bstock",
        shares: 0.025,
        user: "0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual(mockPlan);
  });
});
