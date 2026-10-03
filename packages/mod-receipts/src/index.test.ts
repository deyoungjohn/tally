import { describe, expect, it } from "vitest";
import {
  decodeGuarded,
  decodeRevert,
  decodeTransfer,
  differenceBps,
  GUARDED_TOPIC,
  qualityReport,
  receiptShares,
  reconcile,
  TRANSFER_TOPIC,
} from "./index";
import { historicalSimulation, recordedReceipt, vectorNames } from "./fixtures/recorded";
import { edgeCases, edgeReceipt } from "./fixtures/edges";
import { E18, parseDecimal } from "@tally/core";
import type { ReferencePrice } from "./quality";
import type { Hex, Receipt } from "./types";

describe("on-chain F6/F11 vectors (no network)", () => {
  it("F6 NVDAB: -0.51% vs quote, above signed minimum => RECONCILED_WITH_DIFFERENCE", () => {
    const result = reconcile(recordedReceipt("F6_NVDAB"));
    expect(result.status).toBe("RECONCILED_WITH_DIFFERENCE");
    expect(result.tokensReceived).toBe(25957237393326391n);
    expect(result.sharesReceived).toBe(25977437932023150n);
    expect(result.diffVsQuoteBps).toBeCloseTo(-50.7341, 4);
    expect(result.diffVsSimBps).toBeNull();
    expect(result.notes).toContain("compared with quote; no simulation recorded");
  });
  it("F6 NVDAon: exact +0.0082569% vs quote at send is within 0.01% => RECONCILED", () => {
    const result = reconcile(recordedReceipt("F6_NVDAon"));
    expect(result.status).toBe("RECONCILED");
    expect(result.tokensReceived).toBe(26092638158534866n);
    expect(result.sharesReceived).toBe(26137393524720490n);
    expect(result.diffVsQuoteBps).toBeCloseTo(0.8256, 4);
    expect(result.guarded).toBeNull();
  });
  it("F6 out-of-gas: mined revert => FAILED; historical gas-capped call decodes FailedInnerCall", () => {
    const receipt = recordedReceipt("F6_failed_NVDAon");
    const result = reconcile(receipt);
    expect(result.status).toBe("FAILED");
    expect(result.notes).toContain("FailedInnerCall()");
    expect(result.tokensReceived).toBeNull();
    expect(receipt.realized!.gasUsed).toBe(434909n);
  });
  it.each(["F11_NVDAB", "F11_NVDAon"] as const)(
    "%s: real Guarded event + Transfer cross-check => RECONCILED",
    (name) => {
      const receipt = recordedReceipt(name);
      const result = reconcile(receipt);
      expect(result.status).toBe("RECONCILED");
      expect(result.guarded!.tokensOut).toBe(result.tokensReceived);
      expect(result.guarded!.shares).toBe(result.sharesReceived);
      expect(result.tokensSpent).toBe(6n * E18);
      expect(result.sharesReceived! >= receipt.intent.minShares).toBe(true);
    },
  );
  it.each(["F11_NVDAB", "F11_NVDAon"] as const)(
    "%s: historical reconstruction is usable and labelled separately",
    (name) => {
      const receipt = recordedReceipt(name);
      const simulation = historicalSimulation(name);
      const result = reconcile({ ...receipt, simulation, simulationMissingReason: null });
      expect(result.status).toBe("RECONCILED");
      expect(result.diffVsSimBps).not.toBeNull();
      expect(simulation.block).toBe(receipt.realized!.block! - 1n);
      expect(result.notes.some((note) => note.includes("Reconstruction"))).toBe(true);
      expect(receipt.simulation).toBeNull();
    },
  );
  it("reads mixed-case addresses without losing raw evidence", () => {
    const receipt = recordedReceipt("F11_NVDAB");
    receipt.intent.recipient = receipt.intent.recipient.toUpperCase() as `0x${string}`;
    expect(reconcile(receipt).status).toBe("RECONCILED");
  });
});

describe("labelled synthetic edge cases derived from real vectors", () => {
  it("every edge fixture is explicitly synthetic", () =>
    expect(edgeCases.every((fixture) => fixture.synthetic === true)).toBe(true));
  it.each([
    ["wrong-decimals", "decimals"],
    ["missing-transfer", "Transfer"],
    ["wrong-asset", "Transfer"],
    ["unexplained-transfer", "does not explain"],
    ["wrong-transaction", "another transaction"],
    ["duplicate-log", "Duplicate"],
    ["removed-log", "removed"],
    ["guard-missing", "Guarded"],
    ["below-minimum", "below"],
    ["truncated-event", "length"],
    ["spoofed-guard", "Guarded"],
    ["wrong-conversion", "frozen observation"],
  ])("%s => UNRECONCILED with a reason", (id, reason) => {
    const result = reconcile(edgeReceipt(id!));
    expect(result.status).toBe("UNRECONCILED");
    expect(result.notes.some((note) => note.includes(reason!))).toBe(true);
  });
  it("later multiplier change leaves the receipt unchanged", () => {
    const fixture = edgeCases.find((item) => item.id === "later-multiplier")!;
    const receipt = edgeReceipt(fixture.id);
    const before = reconcile(receipt);
    const latestObservation = {
      ...receipt.conversion!,
      multiplier: BigInt(fixture.value!),
      observationId: "synthetic:later",
      observedAt: 1791040000000,
    };
    expect(receiptShares(before.tokensReceived!, latestObservation)).not.toBe(
      before.sharesReceived,
    );
    expect(reconcile(receipt)).toEqual(before);
    expect(receipt.conversion!.observationId).not.toBe(latestObservation.observationId);
  });
  it.each(["exact-threshold", "negative-threshold"])("%s: inclusive exact 1bp boundary", (id) =>
    expect(reconcile(edgeReceipt(id)).status).toBe("RECONCILED"),
  );
  it("one raw unit above 1bp cannot be rounded into RECONCILED", () => {
    const result = reconcile(edgeReceipt("above-threshold"));
    expect(result.diffVsQuoteBps).toBe(1);
    expect(result.status).toBe("RECONCILED_WITH_DIFFERENCE");
  });
  it("compares to simulation when present, even if the quote differs", () => {
    const receipt = edgeReceipt("simulation-overrides-quote");
    const result = reconcile({
      ...receipt,
      simulation: historicalSimulation("F11_NVDAB"),
      simulationMissingReason: null,
    });
    expect(result.status).toBe("RECONCILED");
    expect(result.diffVsQuoteBps!).toBeLessThan(-1000);
    expect(result.diffVsSimBps!).toBeLessThan(1);
    expect(result.notes).not.toContain("compared with quote; no simulation recorded");
  });
  it("missing simulation without a reason cannot be silently substituted", () => {
    const receipt = edgeReceipt("exact-threshold");
    expect(reconcile({ ...receipt, simulation: null, simulationMissingReason: "" }).status).toBe(
      "UNRECONCILED",
    );
  });
  it("receipt unavailable => PENDING, hash retained", () => {
    const receipt = edgeReceipt("pending");
    const hash = receipt.txHash;
    expect(reconcile(receipt).status).toBe("PENDING");
    expect(receipt.txHash).toBe(hash);
  });
  it("simulation with a different gas cap cannot reconcile", () => {
    const fixture = edgeCases.find((item) => item.id === "simulation-wrong-gas")!;
    const receipt = edgeReceipt(fixture.id);
    const simulation = historicalSimulation("F11_NVDAB");
    const result = reconcile({
      ...receipt,
      simulation: { ...simulation, gasLimit: simulation.gasLimit + BigInt(fixture.value!) },
      simulationMissingReason: null,
    });
    expect(result.status).toBe("UNRECONCILED");
    expect(result.notes).toContain("Simulation did not use the gas limit sent");
  });
  it("reverted receipt without revert bytes stays FAILED and explains the missing cause", () => {
    const result = reconcile(edgeReceipt("no-revert-bytes"));
    expect(result.status).toBe("FAILED");
    expect(result.notes).toContain("Revert data unavailable in transaction receipt");
    expect(result.notes).toContain("Transaction reverted; cause not recorded");
  });
  it.each(["insufficient-shares-revert", "token-paused-revert", "nested-revert"])(
    "%s is decoded as FAILED",
    (id) => {
      const receipt = edgeReceipt(id);
      expect(reconcile(receipt).status).toBe("FAILED");
      const decoded = decodeRevert(receipt.realized!.revertData!);
      expect(decoded.name).not.toBe("Unknown");
      if (id === "nested-revert") expect(decoded.inner!.name).toBe("FailedInnerCall");
      if (id === "insufficient-shares-revert")
        expect(decoded.args).toEqual({ shares: 1n, minShares: 2n });
    },
  );
});

describe("strict evidence decoders", () => {
  it("decodes genuine Guarded fields and Transfer amounts from each F11 receipt", () => {
    for (const name of ["F11_NVDAB", "F11_NVDAon"] as const) {
      const receipt = recordedReceipt(name);
      const event = decodeGuarded(
        receipt.realized!.logs.find((log) => log.topics[0] === GUARDED_TOPIC)!,
      );
      expect(event.ok).toBe(true);
      if (event.ok) expect(event.value.stock).toBe(receipt.intent.asset);
      const transfer = decodeTransfer(
        receipt.realized!.logs.find(
          (log) => log.address === receipt.intent.asset && log.topics[0] === TRANSFER_TOPIC,
        )!,
      );
      expect(transfer.ok).toBe(true);
    }
  });
  it("malformed/unknown evidence has an explicit reason", () => {
    const receipt = edgeReceipt("truncated-event");
    expect(
      decodeGuarded(receipt.realized!.logs.find((log) => log.topics[0] === GUARDED_TOPIC)!),
    ).toEqual({ ok: false, reason: "Invalid Guarded data length" });
    expect(decodeTransfer({ topics: [TRANSFER_TOPIC], data: "0x" }).ok).toBe(false);
    expect(decodeRevert("0xdeadbeef").reason).toBe("Unknown revert selector");
    expect(decodeRevert("0xzz" as Hex).reason).toBe("Malformed hex evidence");
    expect(decodeRevert("0x1425ea4200").reason).toBe("Invalid revert data length");
    const nested = edgeReceipt("nested-revert").realized!.revertData!;
    expect(decodeRevert(nested.slice(0, -64) as Hex).name).toBe("Unknown");
  });
  it("share conversion supports token decimals using bigint; absent denominators are unavailable", () => {
    const conversion = edgeReceipt("wrong-decimals").conversion!;
    expect(
      receiptShares(2_000_000n, { ...conversion, tokenDecimals: 6, multiplier: 10n * E18 }),
    ).toBe(20n * E18);
    expect(differenceBps(1n, 0n)).toBeNull();
  });
});

describe("execution quality", () => {
  const receipts = vectorNames.map(recordedReceipt);
  it("four real fills and one failed attempt, grouped by issuer and actual hop count; missing simulations remain unavailable", () => {
    const report = qualityReport(receipts, []);
    expect(report).toMatchObject({
      n: 4,
      completedCount: 5,
      fillRate: 0.8,
      failedCount: 1,
      insufficient: true,
    });
    expect(report.vsSimulation).toEqual({
      n: 0,
      medianBps: null,
      p90Bps: null,
      insufficient: true,
    });
    expect(report.vsReference.n).toBe(0);
    expect(report.byIssuer.find((row) => row.issuer === "ondo")).toMatchObject({
      n: 2,
      fillRate: 2 / 3,
    });
    expect(report.byRouteLength.map((row) => [row.routeLength, row.n])).toEqual([
      [1, 2],
      [2, 1],
      [4, 1],
      [null, 0],
    ]);
    expect(report.vsQuote.medianBps).toBeCloseTo(0.0201, 4);
    expect(report.vsQuote.p90Bps).toBeCloseTo(0.8256, 4);
  });
  it("empty and pending-only samples stay insufficient; pending excluded and counted", () => {
    expect(qualityReport([], [])).toMatchObject({
      n: 0,
      insufficient: true,
      fillRate: null,
      byIssuer: [],
    });
    expect(qualityReport([edgeReceipt("pending")], [])).toMatchObject({
      n: 0,
      pendingCount: 1,
      completedCount: 0,
      fillRate: null,
      insufficient: true,
    });
    expect(qualityReport([...receipts, edgeReceipt("pending")], [])).toMatchObject({
      n: 4,
      pendingCount: 1,
      fillRate: 0.8,
    });
  });
  it("unexplained fills count as completed attempts but never enter price distributions", () => {
    const report = qualityReport(
      [edgeReceipt("missing-transfer"), recordedReceipt("F11_NVDAB")],
      [],
    );
    expect(report).toMatchObject({ n: 1, unreconciledCount: 1, fillRate: 0.5 });
  });
  it("n=5 boundary (synthetic sample sizes) and per-metric insufficiency", () => {
    const receipts: Receipt[] = Array.from({ length: 5 }, (_, i) => {
      const receipt = edgeReceipt("five-fills");
      receipt.intent.id = `synthetic:fill:${i}`;
      return receipt;
    });
    const report = qualityReport(receipts, []);
    expect(report.insufficient).toBe(false);
    expect(report.byIssuer[0]!.insufficient).toBe(false);
    expect(report.vsSimulation.insufficient).toBe(true);
    expect(report.vsQuote.medianBps).toBe(report.vsQuote.p90Bps);
    expect(qualityReport(receipts.slice(1), []).insufficient).toBe(true);
  });
  it("US reference is per share with explicit spend-token USD valuation (synthetic price edge)", () => {
    const fixture = edgeCases.find((item) => item.id === "reference-valuation")!;
    const receipt = edgeReceipt(fixture.id);
    const price: ReferencePrice = {
      intentId: receipt.intent.id,
      ticker: "NVDA",
      usdPerShareE18: parseDecimal(fixture.usdPerShare!, 18),
      spendTokenUsdE18: parseDecimal(fixture.spendTokenUsd!, 18),
      observationId: "synthetic:reference",
      observedAt: 1790935379000,
      source: "synthetic: explicitly assumed USD value",
    };
    const report = qualityReport([receipt], [price]);
    expect(report.vsReference.n).toBe(1);
    expect(report.vsReference.medianBps).toBeCloseTo(-22.0929, 4);
    expect(qualityReport([receipt], [{ ...price, ticker: "AAPL" }]).vsReference.n).toBe(0);
    expect(qualityReport([receipt], [price, price]).vsReference.n).toBe(0);
    expect(
      qualityReport([receipt], [{ ...price, spendTokenUsdE18: 0n }]).notes.some((note) =>
        note.includes("invalid"),
      ),
    ).toBe(true);
  });
  it("historical simulations contribute only to their own sample, not missing originals", () => {
    const receipt = recordedReceipt("F11_NVDAB");
    const reconstructed = {
      ...receipt,
      simulation: historicalSimulation("F11_NVDAB"),
      simulationMissingReason: null,
    };
    const report = qualityReport([reconstructed, recordedReceipt("F6_NVDAB")], []);
    expect(report.vsSimulation.n).toBe(1);
    expect(report.vsQuote.n).toBe(2);
  });
  it("net spend excludes a refunded input amount (synthetic refund edge)", () => {
    const receipt = edgeReceipt("refund");
    expect(reconcile(receipt).tokensSpent).toBe(5n * E18);
  });
});
