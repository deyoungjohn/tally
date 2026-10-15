import { describe, expect, it } from "vitest";
import type { ActivityVM } from "@/modules/receipts/view-model";
import { recentLines } from "./recent-lines";

const item = (over: Record<string, unknown>) =>
  ({
    kind: "sell",
    status: "RECONCILED",
    ticker: "NVDA",
    issuer: "bstock",
    txHash: "0xAbC",
    observedAt: "2026-10-10T10:00:00.000Z",
    ladder: [
      { stage: "Quoted", tokens: "0.048", shares: null },
      { stage: "Received", tokens: "11.02", shares: "0.048" },
    ],
    ...over,
  }) as unknown;

const activity = (...items: unknown[]) => ({ items }) as unknown as ActivityVM;

describe("recentLines", () => {
  it("shows a verified sell with its shares sold and the USDT it paid", () => {
    const [l] = recentLines(activity(item({})), new Set());
    expect(l).toMatchObject({ type: "SELL", amountShares: "0.048", valueUsd: "11.02" });
  });
  it("leaves out a transaction the statement table already shows", () => {
    expect(recentLines(activity(item({})), new Set(["0xabc"]))).toHaveLength(0);
  });
});
