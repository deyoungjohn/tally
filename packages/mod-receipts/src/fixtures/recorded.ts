/** Test-only adapter. Amounts/logs are recorded facts; absent pre-Receipts facts remain null. */
import recorded from "../../../../spike/results/receipt_vectors_20261003T170030619036Z.json";
import f6b from "../../../../spike/results/live_NVDAB_send_20261001T142346Z.json";
import f6o from "../../../../spike/results/live_NVDAon_send_20261001T142428Z.json";
import f11b from "../../../../contracts/results/guarded_NVDAB_send_20261002T100018Z.json";
import f11o from "../../../../contracts/results/guarded_NVDAon_send_20261002T100350Z.json";
import { decodeGuarded, GUARDED_TOPIC } from "../decode";
import { receiptShares } from "../reconcile";
import type { Address } from "@tally/core";
import type { ChainLog, Hex, Receipt, SimulationRecord } from "../types";

export type VectorName = keyof typeof recorded.vectors;
const summaries = { F6_NVDAB: f6b, F6_NVDAon: f6o, F11_NVDAB: f11b, F11_NVDAon: f11o };
export const vectorNames = Object.keys(recorded.vectors) as VectorName[];

export function recordedReceipt(name: VectorName): Receipt {
  const vector = recorded.vectors[name];
  const tx = vector.transaction.result;
  const mined = vector.receipt.result;
  const logs: ChainLog[] = mined.logs.map((log) => ({
    address: log.address as Address,
    topics: log.topics as Hex[],
    data: log.data as Hex,
    transactionHash: log.transactionHash as Hex,
    blockNumber: BigInt(log.blockNumber),
    logIndex: Number(BigInt(log.logIndex)),
    removed: log.removed,
  }));
  const guardedLog = logs.find((log) => log.topics[0] === GUARDED_TOPIC);
  const decoded = guardedLog ? decodeGuarded(guardedLog) : null;
  const guarded = decoded?.ok ? decoded.value : null;
  const summary = name === "F6_failed_NVDAon" ? null : summaries[name];
  const asset = (summary?.tokenAddress ?? f6o.tokenAddress) as Address;
  const conversion = summary
    ? {
        multiplier: BigInt(summary.multiplier),
        tokenDecimals: 18,
        source: guarded
          ? "ShareGuard Guarded event"
          : name === "F6_NVDAB"
            ? "on-chain uiMultiplier"
            : "public RWA API sharesMultiplier",
        observationId: guarded
          ? `${vector.txHash}:${guardedLog!.logIndex}`
          : `spike/results/live_${summary.token}_send:${summary.startedAtUtc}`,
        observedAt: null,
        observedAtReason:
          "Exact observation timestamp not recorded; original run started " + summary.startedAtUtc,
      }
    : null;
  // Guarded calldata word 3 is the actual signed minShares. F6 summaries store the router's token minimum.
  const minShares = guarded
    ? BigInt(`0x${tx.input.slice(10 + 3 * 64, 10 + 4 * 64)}`)
    : summary && "minReceive" in summary && conversion
      ? receiptShares(BigInt(summary.minReceive), conversion)
      : 0n;
  const quote = summary
    ? {
        quoteId: null,
        expectedOut: {
          asset,
          raw: BigInt(
            "toTokenAmountAtSend" in summary
              ? summary.toTokenAmountAtSend
              : summary.quote.toTokenAmountAtSend,
          ),
          decimals: 18,
        },
        route: ("routeAtSend" in summary ? summary.routeAtSend : summary.quote.routeAtSend).split(
          " > ",
        ),
        router: summary.quote.router as Address,
        observedAt: null,
        expiresAt: null,
        notes: ["Original quote ID, exact observation/expiry and approval timestamps not recorded"],
      }
    : null;
  const historicalError = "error" in vector.historicalCall ? vector.historicalCall.error : null;
  return {
    intent: {
      id: vector.txHash,
      kind: "buy",
      ticker: "NVDA",
      asset,
      issuer: name.includes("NVDAB") ? "bstock" : "ondo",
      tokenDecimals: 18,
      user: tx.from as Address,
      recipient: tx.from as Address,
      spend: {
        asset: "0x55d398326f99059ff775485246999027b3197955",
        raw: 6n * 10n ** 18n,
        decimals: 18,
      },
      minShares,
      toleranceBps: 100,
      approvedAt: null,
      guard: guarded ? (tx.to as Address) : null,
    },
    quote,
    quoteMissingReason: quote ? null : "Failed pre-Receipts trade; quote not recorded",
    conversion,
    conversionMissingReason: conversion
      ? null
      : "Failed pre-Receipts trade; multiplier not recorded",
    simulation: null,
    simulationMissingReason: "not recorded: pre-Receipts trade",
    txHash: vector.txHash as Hex,
    realized: {
      txHash: mined.transactionHash as Hex,
      block: BigInt(mined.blockNumber),
      status: mined.status === "0x1" ? "success" : "reverted",
      gasUsed: BigInt(mined.gasUsed),
      gasLimit: BigInt(tx.gas),
      logs,
      revertData:
        historicalError && "data" in historicalError ? (historicalError.data as Hex) : null,
      failureReason: historicalError
        ? "FailedInnerCall reproduced by historical eth_call at block - 1 and original gas cap; F6 documents out-of-gas"
        : null,
    },
    notes: summary
      ? ["Original simulation not recorded; historical reconstruction is retained separately"]
      : ["F6 records 6 USDT input and 1% tolerance; signed minimum and conversion unavailable"],
  };
}

/** The guard returns shares, not tokens. Invert only if it maps exactly to a unique raw token amount. */
export function historicalSimulation(name: "F11_NVDAB" | "F11_NVDAon"): SimulationRecord {
  const vector = recorded.vectors[name];
  const receipt = recordedReceipt(name);
  const shares = BigInt(vector.historicalCall.result);
  const multiplier = receipt.conversion!.multiplier;
  const tokens = (shares * 10n ** 18n + multiplier - 1n) / multiplier;
  if (receiptShares(tokens, receipt.conversion!) !== shares)
    throw new Error("Historical shares cannot be inverted exactly");
  return {
    expectedOut: { asset: receipt.intent.asset, raw: tokens, decimals: 18 },
    gasLimit: BigInt(vector.transaction.result.gas),
    observedAt: Date.parse(recorded.recordedAt),
    source: "historical-eth_call",
    block: BigInt(vector.historicalCall.block),
    notes: [
      "Reconstruction at previous block, not an original simulation; raw output uniquely derived from the guard's returned shares",
    ],
  };
}
