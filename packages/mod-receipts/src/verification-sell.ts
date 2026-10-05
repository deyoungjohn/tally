import type { Address, RegistryToken } from "@tally/core";
import { decodeTransfer, TRANSFER_TOPIC } from "./decode";
import type { AnyReceiptHint } from "./hints";
import { differenceBps } from "./reconcile";

export const DEFAULT_LIQUIDMESH_ROUTER = "0xb44446b0c8e56988c34f7ff73ae904982b5fdda5" as Address;
export const DEFAULT_USDT_BSC = "0x55d398326f99059ff775485246999027b3197955" as Address;
import type { Receipt, Reconciliation } from "./types";
import {
  equalAddress,
  verifyMinedTransaction,
  type MinedEvidence,
  type StoredReceipt,
  type TransactionEvidence,
} from "./verification";

const APPROVE = "0x095ea7b3";

export type SignedSellCall =
  | {
      kind: "stock_approval";
      stock: Address;
      approveTarget: Address;
      amount: bigint;
    }
  | {
      kind: "sell";
      stock: Address | null;
      router: Address;
      minUsdtOut: bigint | null;
      quotedUsdtOut: bigint | null;
      tokensIn: bigint | null;
    };

export interface VerifiedSellFillResult {
  tokensSpent: bigint;
  usdtReceived: bigint;
  stockAddress?: Address;
}

export interface SellMultiplierEvidence {
  value: bigint;
  source: string;
  observedAt: number;
}

/**
 * Verifies signed call data for a sell or stock approval transaction.
 * Condition 1: Router imported from @tally/config (LIQUIDMESH_ROUTER).
 * Condition 2: Stock approval destination verified against trusted registry tokens for hint.ticker,
 * spender verified against ShareGuard's configured approve target, non-zero and non-unlimited.
 */
export function verifySignedSellCall(
  tx: TransactionEvidence,
  hint: AnyReceiptHint,
  trustedTokens: readonly RegistryToken[],
  approveTarget: Address,
  router: Address = DEFAULT_LIQUIDMESH_ROUTER,
): SignedSellCall {
  if (hint.kind !== "sell") {
    throw new Error("Transaction is not a sell intent");
  }
  if (!equalAddress(tx.hash, hint.txHash) || !equalAddress(tx.sender, hint.user)) {
    throw new Error("Transaction sender/hash does not match intent");
  }
  if (tx.value !== 0n || tx.gasLimit <= 0n || !/^0x(?:[\da-f]{2})*$/i.test(tx.input)) {
    throw new Error("Invalid sell transaction");
  }

  const selector = tx.input.slice(0, 10).toLowerCase();
  if (tx.inputSelector.toLowerCase() !== selector) {
    throw new Error("Input selector mismatch");
  }
  const data = tx.input.slice(10).toLowerCase();
  const word = (i: number) => {
    const w = data.slice(i * 64, (i + 1) * 64);
    if (w.length !== 64) throw new Error("Truncated calldata");
    return w;
  };
  const uint = (i: number) => BigInt(`0x${word(i)}`);
  const addr = (i: number): Address => {
    const w = word(i);
    if (!/^0{24}/.test(w)) throw new Error("Invalid calldata address");
    return `0x${w.slice(24)}`.toLowerCase() as Address;
  };

  // Stock approval check: destination must match a trusted registry token for hint.ticker
  const matchingToken = trustedTokens.find((t) => equalAddress(t.address, tx.destination));
  if (matchingToken) {
    if (
      selector !== APPROVE ||
      data.length !== 128 ||
      !equalAddress(addr(0), approveTarget) ||
      uint(1) <= 0n ||
      uint(1) === 2n ** 256n - 1n
    ) {
      throw new Error("Only a stock approval to configured approve target is accepted");
    }
    return {
      kind: "stock_approval",
      stock: matchingToken.address,
      approveTarget,
      amount: uint(1),
    };
  }

  // Sell check: destination must be allow-listed LiquidMesh router
  if (!equalAddress(tx.destination, router)) {
    throw new Error("Transaction destination is not the allow-listed LiquidMesh router");
  }

  // Stock check: if quote hint exists, must match trusted registry for ticker.
  // Without a quote hint, stock attribution is resolved from logs at fill time (Finding 3).
  let stockAddress: Address | null = null;
  if (hint.quote) {
    const stockToken = trustedTokens.find((t) => equalAddress(t.address, hint.quote!.stock));
    if (!stockToken) {
      throw new Error("Stock is not in trusted registry for ticker");
    }
    stockAddress = stockToken.address;
  }

  const minUsdtOut =
    hint.quote && "minUsdtOut" in hint.quote && hint.quote.minUsdtOut
      ? BigInt(hint.quote.minUsdtOut)
      : null;
  const quotedUsdtOut =
    hint.quote && "quotedUsdtOut" in hint.quote && hint.quote.quotedUsdtOut
      ? BigInt(hint.quote.quotedUsdtOut)
      : null;
  const tokensIn =
    hint.quote && "tokensIn" in hint.quote && hint.quote.tokensIn
      ? BigInt(hint.quote.tokensIn)
      : null;

  return {
    kind: "sell",
    stock: stockAddress,
    router,
    minUsdtOut,
    quotedUsdtOut,
    tokensIn,
  };
}

/**
 * Extracts realized stock tokens sold and net USDT received from mined receipt logs.
 * Condition 3:
 * - USDT received is net: Transfers of USDT to the sender minus Transfers of USDT from the sender.
 * - Stock sold is the sum of stock Transfers from the sender.
 */
export function verifiedSellFill(
  tx: TransactionEvidence,
  mined: MinedEvidence | null,
  call: SignedSellCall,
  trustedTokens: RegistryToken[] = [],
  usdt: Address = DEFAULT_USDT_BSC,
): VerifiedSellFillResult | null {
  if (!mined || mined.status === "reverted" || call.kind !== "sell") return null;

  // Strict log verification (Finding 2): reject if removed, block mismatch, txHash mismatch, or duplicate index
  const indices = new Set<number>();
  for (const log of mined.logs) {
    if (
      log.removed ||
      log.blockNumber !== mined.blockNumber ||
      !equalAddress(log.transactionHash, tx.hash) ||
      !Number.isSafeInteger(log.logIndex) ||
      log.logIndex < 0 ||
      indices.has(log.logIndex)
    ) {
      return null;
    }
    indices.add(log.logIndex);
  }

  // Stock attribution (Finding 3):
  // If call.stock is present, use it.
  // With no quote hint, pick the trusted token that has a Transfer out of the sender in the logs;
  // if none or more than one, UNRECONCILED (return null).
  let stockAddr = call.stock;
  if (!stockAddr) {
    const transferredTokens = new Set<string>();
    for (const log of mined.logs) {
      if (log.topics[0]?.toLowerCase() === TRANSFER_TOPIC) {
        const transfer = decodeTransfer(log);
        if (
          transfer.ok &&
          equalAddress(transfer.value.from, tx.sender) &&
          transfer.value.value > 0n
        ) {
          const match = trustedTokens.find((t) => equalAddress(t.address, log.address));
          if (match) {
            transferredTokens.add(match.address.toLowerCase());
          }
        }
      }
    }
    if (transferredTokens.size !== 1) {
      return null;
    }
    stockAddr = [...transferredTokens][0] as Address;
  }

  let stockSpent = 0n;
  let usdtReceived = 0n;

  for (const log of mined.logs) {
    if (log.topics[0]?.toLowerCase() === TRANSFER_TOPIC) {
      const transfer = decodeTransfer(log);
      if (!transfer.ok) continue;
      const t = transfer.value;

      // Stock sold: sum of stock Transfers from the sender
      if (equalAddress(log.address, stockAddr)) {
        if (equalAddress(t.from, tx.sender)) {
          stockSpent += t.value;
        }
      }

      // USDT received: net transfers (to sender minus from sender)
      if (equalAddress(log.address, usdt)) {
        if (equalAddress(t.to, tx.sender)) {
          usdtReceived += t.value;
        }
        if (equalAddress(t.from, tx.sender)) {
          usdtReceived -= t.value;
        }
      }
    }
  }

  return {
    tokensSpent: stockSpent,
    usdtReceived,
    stockAddress: stockAddr,
  };
}

/**
 * Reconciles a sell transaction according to Condition 5:
 * - reverted = FAILED
 * - not mined = PENDING
 * - success with stock sold > 0 and USDT received > 0 (and received >= client-reported floor when sent) = RECONCILED
 * - anything else = UNRECONCILED with note
 * - No RECONCILED_WITH_DIFFERENCE for sells
 */
export function reconcileSell(
  tx: TransactionEvidence,
  mined: MinedEvidence | null,
  call: SignedSellCall,
  fill: VerifiedSellFillResult | null,
  shares: bigint | null,
  sharesMissingReason: string | null,
  minUsdtOut: bigint | null,
  quotedUsdtOut: bigint | null,
): Reconciliation {
  const notes: string[] = [];

  if (!mined) {
    return {
      status: "PENDING",
      diffVsQuoteBps: null,
      diffVsSimBps: null,
      tokensReceived: null,
      tokensSpent: null,
      sharesReceived: null,
      guarded: null,
      notes: ["Transaction not yet mined on chain"],
    };
  }

  if (mined.status === "reverted") {
    return {
      status: "FAILED",
      diffVsQuoteBps: null,
      diffVsSimBps: null,
      tokensReceived: 0n,
      tokensSpent: 0n,
      sharesReceived: 0n,
      guarded: null,
      notes: ["Transaction reverted on chain"],
    };
  }

  if (call.kind === "stock_approval") {
    return {
      status: "RECONCILED",
      diffVsQuoteBps: null,
      diffVsSimBps: null,
      tokensReceived: null,
      tokensSpent: null,
      sharesReceived: null,
      guarded: null,
      notes: ["Stock approval confirmed on chain"],
    };
  }

  if (!fill) {
    notes.push(
      "Transaction logs could not be verified or stock transfer could not be uniquely attributed",
    );
    return {
      status: "UNRECONCILED",
      diffVsQuoteBps: null,
      diffVsSimBps: null,
      tokensReceived: null,
      tokensSpent: null,
      sharesReceived: null,
      guarded: null,
      notes,
    };
  }

  const stockSold = fill.tokensSpent;
  const usdtReceived = fill.usdtReceived;

  // Condition 3: If no stock Transfer from the sender exists, receipt is UNRECONCILED
  if (stockSold <= 0n) {
    notes.push("No stock Transfer from the sender exists in transaction logs");
    return {
      status: "UNRECONCILED",
      diffVsQuoteBps: null,
      diffVsSimBps: null,
      tokensReceived: usdtReceived,
      tokensSpent: stockSold,
      sharesReceived: shares,
      guarded: null,
      notes,
    };
  }

  if (usdtReceived <= 0n) {
    notes.push("No net USDT received by the sender");
    return {
      status: "UNRECONCILED",
      diffVsQuoteBps: null,
      diffVsSimBps: null,
      tokensReceived: usdtReceived,
      tokensSpent: stockSold,
      sharesReceived: shares,
      guarded: null,
      notes,
    };
  }

  if (minUsdtOut !== null && usdtReceived < minUsdtOut) {
    notes.push(
      `Net USDT received (${usdtReceived}) is below client-reported floor (${minUsdtOut})`,
    );
    return {
      status: "UNRECONCILED",
      diffVsQuoteBps: null,
      diffVsSimBps: null,
      tokensReceived: usdtReceived,
      tokensSpent: stockSold,
      sharesReceived: shares,
      guarded: null,
      notes,
    };
  }

  let diffVsQuoteBps: number | null = null;
  if (quotedUsdtOut !== null && quotedUsdtOut > 0n) {
    diffVsQuoteBps = differenceBps(usdtReceived, quotedUsdtOut);
  }

  if (sharesMissingReason) {
    notes.push(sharesMissingReason);
  }

  return {
    status: "RECONCILED",
    diffVsQuoteBps,
    diffVsSimBps: null,
    tokensReceived: usdtReceived,
    tokensSpent: stockSold,
    sharesReceived: shares,
    guarded: null,
    notes,
  };
}

/**
 * Promotes a mined sell transaction to StoredReceipt with verified chain evidence.
 * Condition 4: Shares are derived with the engine's accepted multiplier at verification time
 * and labelled with source and time; if unavailable, shares are null with a reason. Never 1:1, never browser's.
 */
export function promoteSellReceipt(
  hint: AnyReceiptHint,
  tx: TransactionEvidence,
  mined: MinedEvidence | null,
  call: SignedSellCall,
  token: RegistryToken | null,
  multiplier: SellMultiplierEvidence | null,
  now: number,
  trustedTokens: RegistryToken[] = [],
): StoredReceipt {
  if (hint.kind !== "sell") {
    throw new Error("Transaction is not a sell intent");
  }
  verifyMinedTransaction(tx, mined);

  if (call.kind === "stock_approval") {
    return {
      kind: "stock_approval",
      transaction: tx,
      chainReceipt: mined,
      receipt: null,
      result: null,
      hint,
      baselineTrust: "client-hint",
      verifiedAt: now,
      verifiedFill: null,
    };
  }

  const fill = verifiedSellFill(
    tx,
    mined,
    call,
    trustedTokens.length > 0 ? trustedTokens : token ? [token] : [],
  );

  const effectiveStock = call.stock ?? fill?.stockAddress ?? token?.address ?? null;
  const effectiveToken =
    token ??
    (fill?.stockAddress
      ? (trustedTokens.find((t) => equalAddress(t.address, fill.stockAddress ?? null)) ?? null)
      : null);

  if (
    !effectiveToken ||
    !effectiveStock ||
    !equalAddress(effectiveToken.address, effectiveStock) ||
    effectiveToken.ticker !== hint.ticker
  ) {
    throw new Error("Stock metadata does not match the trusted registry");
  }

  const shares =
    fill && fill.tokensSpent > 0n && multiplier && multiplier.value > 0n
      ? (fill.tokensSpent * multiplier.value) / 10n ** 18n
      : null;
  const sharesMissingReason =
    !multiplier || multiplier.value <= 0n
      ? "Multiplier unavailable from engine facts at verification time"
      : null;

  const result = reconcileSell(
    tx,
    mined,
    call,
    fill,
    shares,
    sharesMissingReason,
    call.minUsdtOut,
    call.quotedUsdtOut,
  );

  const receipt: Receipt = {
    intent: {
      id: hint.intentId,
      kind: "sell",
      ticker: effectiveToken.ticker,
      issuer: effectiveToken.issuer,
      asset: effectiveStock,
      tokenDecimals: effectiveToken.decimals,
      user: tx.sender,
      recipient: tx.sender,
      spend: { asset: effectiveStock, raw: call.tokensIn ?? fill?.tokensSpent ?? 0n, decimals: 18 },
      minShares: 0n,
      toleranceBps: 0,
      approvedAt: null,
      guard: null,
    },
    quote:
      hint.quote && "quotedUsdtOut" in hint.quote
        ? {
            quoteId: null,
            expectedOut: {
              asset: DEFAULT_USDT_BSC,
              raw: BigInt(hint.quote.quotedUsdtOut),
              decimals: 18,
            },
            route: hint.quote.routeText.split(" → "),
            router: call.router,
            observedAt: hint.quote.builtAt,
            expiresAt: hint.quote.expiresAt,
            notes: ["Quote and floor are unverified client hints; comparison is client-reported"],
          }
        : null,
    quoteMissingReason: hint.quote ? null : "Original quote unavailable after resuming",
    simulation: null,
    simulationMissingReason: "Sell does not record simulation output",
    conversion:
      multiplier && multiplier.value > 0n
        ? {
            multiplier: multiplier.value,
            tokenDecimals: 18,
            source: multiplier.source,
            observationId: `${tx.hash}:${multiplier.observedAt}`,
            observedAt: multiplier.observedAt,
            observedAtReason: null,
          }
        : null,
    conversionMissingReason: sharesMissingReason,
    txHash: tx.hash,
    realized: mined
      ? {
          txHash: mined.hash,
          block: mined.blockNumber,
          status: mined.status,
          gasUsed: mined.gasUsed,
          gasLimit: tx.gasLimit,
          logs: mined.logs,
          revertData: null,
          failureReason:
            mined.status === "reverted" ? "Chain confirms revert; revert data unavailable" : null,
        }
      : null,
    notes: [
      "Realized stock sent and USDT received read strictly from verified chain logs; browser floor is client-reported",
    ],
  };

  return {
    kind: "sell",
    transaction: tx,
    chainReceipt: mined,
    receipt,
    result,
    hint,
    baselineTrust: "client-hint",
    verifiedAt: now,
    verifiedFill: fill
      ? {
          tokens: fill.tokensSpent,
          shares,
        }
      : null,
  };
}
