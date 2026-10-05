import type { Address, RegistryToken } from "@tally/core";
import { decodeGuarded, decodeTransfer, GUARDED_TOPIC, TRANSFER_TOPIC } from "./decode";
import { reconcile } from "./reconcile";
import type { ReceiptHint } from "./hints";
import type { ChainLog, Hex, Receipt, Reconciliation } from "./types";

// ShareGuard v1 ABI signatures: contracts/src/ShareGuard.sol. Exact selectors, no dependency or I/O.
const SWAP = "0xbe34dbeb",
  SWAP_WITH_FEED = "0xbd88b722",
  APPROVE = "0x095ea7b3";
export interface TransactionEvidence {
  hash: Hex;
  sender: Address;
  destination: Address | null;
  value: bigint;
  input: Hex;
  inputSelector: Hex;
  blockNumber: bigint | null;
  gasLimit: bigint;
}
export interface MinedEvidence {
  hash: Hex;
  sender: Address;
  destination: Address | null;
  blockNumber: bigint;
  gasUsed: bigint;
  status: "success" | "reverted";
  logs: readonly ChainLog[];
}
export type SignedCall =
  | { kind: "approval"; amount: bigint }
  | {
      kind: "swap";
      tokenIn: Address;
      amountIn: bigint;
      stock: Address;
      minShares: bigint;
      router: Address;
      recipient: Address;
    };
export interface StoredReceipt {
  lastCheckedAt?: number;
  kind: "swap" | "approval";
  transaction: TransactionEvidence;
  chainReceipt: MinedEvidence | null;
  receipt: Receipt | null;
  result: Reconciliation | null;
  hint: ReceiptHint;
  baselineTrust: "client-hint" | "recorded";
  pendingReason?: string;
  verifiedAt: number;
  verifiedFill: { tokens: bigint; shares: bigint } | null;
}
export const equalAddress = (a: string | null, b: string | null) =>
  a !== null && b !== null && a.toLowerCase() === b.toLowerCase();
/** Only signed chain calldata can define the share floor, assets, spender and recipient. */
export function verifySignedCall(
  tx: TransactionEvidence,
  hint: ReceiptHint,
  guard: Address = "0x28f6f19bffbf25e36452c78d12090f0bc922970a",
  usdt: Address = "0x55d398326f99059ff775485246999027b3197955",
): SignedCall {
  if (!equalAddress(tx.hash, hint.txHash) || !equalAddress(tx.sender, hint.user))
    throw new Error("Transaction sender/hash does not match intent");
  if (tx.value !== 0n || tx.gasLimit <= 0n || !/^0x(?:[\da-f]{2})*$/i.test(tx.input))
    throw new Error("Invalid stock transaction");
  const selector = tx.input.slice(0, 10).toLowerCase();
  if (tx.inputSelector.toLowerCase() !== selector) throw new Error("Input selector mismatch");
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
    return `0x${w.slice(24)}`;
  };
  if (equalAddress(tx.destination, usdt)) {
    if (
      selector !== APPROVE ||
      data.length !== 128 ||
      !equalAddress(addr(0), guard) ||
      uint(1) <= 0n ||
      uint(1) === 2n ** 256n - 1n
    )
      throw new Error("Only a USDT approval to ShareGuard is accepted");
    return { kind: "approval", amount: uint(1) };
  }
  if (!equalAddress(tx.destination, guard) || ![SWAP, SWAP_WITH_FEED].includes(selector))
    throw new Error("Transaction is not a ShareGuard swap or USDT approval");
  const headWords = selector === SWAP ? 8 : 13;
  // Canonical bytes offsets, bounds and padding; rejects truncated / misleading fixed-word decodes.
  let end = headWords * 64;
  for (const i of selector === SWAP ? [5] : [5, 12]) {
    const offset = uint(i);
    if (offset * 2n !== BigInt(end)) throw new Error("Noncanonical calldata offset");
    const length = uint(end / 64);
    if (length > BigInt(data.length / 2)) throw new Error("Truncated calldata bytes");
    const padded = Number((length + 31n) / 32n) * 64;
    const bytesEnd = end + 64 + Number(length) * 2;
    const next = end + 64 + padded;
    if (next > data.length || !/^0*$/.test(data.slice(bytesEnd, next)))
      throw new Error("Invalid calldata padding");
    end = next;
  }
  if (end !== data.length) throw new Error("Unexpected calldata tail");
  const call: SignedCall = {
    kind: "swap",
    tokenIn: addr(0),
    amountIn: uint(1),
    stock: addr(2),
    minShares: uint(3),
    router: addr(4),
    recipient: addr(6),
  };
  if (
    !equalAddress(call.tokenIn, usdt) ||
    call.amountIn <= 0n ||
    call.minShares <= 0n ||
    /^0x0{40}$/.test(call.recipient)
  )
    throw new Error("Unsupported stock buy");
  if (
    hint.quote &&
    (!equalAddress(call.stock, hint.quote.stock) ||
      call.minShares !== BigInt(hint.quote.minShares) ||
      call.amountIn !== BigInt(hint.quote.amountInUsdt))
  )
    throw new Error("Quote hint does not match signed assets, input or minimum");
  return call;
}
/** A chain fill can be proved even when replay lost the original quote. No invented comparison baseline. */
function verifiedFill(tx: TransactionEvidence, mined: MinedEvidence | null, call: SignedCall) {
  if (!mined || mined.status !== "success" || call.kind !== "swap") return null;
  const indices = new Set<number>();
  let count = 0,
    tokens = 0n,
    forwarded = 0n;
  let event: ReturnType<typeof decodeGuarded> | null = null;
  for (const log of mined.logs) {
    if (
      log.removed ||
      log.blockNumber !== mined.blockNumber ||
      !equalAddress(log.transactionHash, tx.hash) ||
      !Number.isSafeInteger(log.logIndex) ||
      log.logIndex < 0 ||
      indices.has(log.logIndex)
    )
      return null;
    indices.add(log.logIndex);
    if (
      equalAddress(log.address, tx.destination) &&
      log.topics[0]?.toLowerCase() === GUARDED_TOPIC
    ) {
      count++;
      event = decodeGuarded(log);
    }
    if (equalAddress(log.address, call.stock) && log.topics[0]?.toLowerCase() === TRANSFER_TOPIC) {
      const transfer = decodeTransfer(log);
      if (!transfer.ok) return null;
      const t = transfer.value;
      if (equalAddress(t.to, call.recipient)) {
        tokens += t.value;
        if (equalAddress(t.from, tx.destination)) forwarded += t.value;
      }
      if (equalAddress(t.from, call.recipient)) tokens -= t.value;
    }
  }
  if (count !== 1 || !event?.ok) return null;
  const e = event.value;
  if (
    !equalAddress(e.user, tx.sender) ||
    !equalAddress(e.recipient, call.recipient) ||
    !equalAddress(e.stock, call.stock) ||
    !equalAddress(e.tokenIn, call.tokenIn) ||
    !equalAddress(e.router, call.router) ||
    e.amountIn !== call.amountIn ||
    e.multiplier <= 0n ||
    tokens <= 0n ||
    e.tokensOut !== tokens ||
    forwarded !== tokens ||
    e.shares !== (tokens * e.multiplier) / 10n ** 18n ||
    e.shares < call.minShares
  )
    return null;
  return { tokens, shares: e.shares };
}
export function verifyMinedTransaction(tx: TransactionEvidence, mined: MinedEvidence | null): void {
  if (
    mined &&
    (!equalAddress(mined.hash, tx.hash) ||
      !equalAddress(mined.sender, tx.sender) ||
      !equalAddress(mined.destination, tx.destination) ||
      tx.blockNumber !== mined.blockNumber ||
      mined.gasUsed < 0n ||
      mined.gasUsed > tx.gasLimit)
  )
    throw new Error("Chain transaction/receipt mismatch");
}
export function promoteReceipt(
  hint: ReceiptHint,
  tx: TransactionEvidence,
  mined: MinedEvidence | null,
  call: SignedCall,
  token: RegistryToken | null,
  now: number,
): StoredReceipt {
  verifyMinedTransaction(tx, mined);
  if (call.kind === "approval")
    return {
      kind: "approval",
      transaction: tx,
      chainReceipt: mined,
      receipt: null,
      result: null,
      hint,
      baselineTrust: "client-hint",
      verifiedAt: now,
      verifiedFill: null,
    };
  if (
    !token ||
    !equalAddress(token.address, call.stock) ||
    token.ticker !== hint.ticker ||
    !["ondo", "bstock"].includes(token.issuer) ||
    token.decimals !== 18 ||
    (hint.quote && token.issuer !== hint.quote.issuer)
  )
    throw new Error("Stock metadata does not match the trusted registry");
  const events =
    mined?.logs.filter(
      (l) =>
        equalAddress(l.address, tx.destination) && l.topics[0]?.toLowerCase() === GUARDED_TOPIC,
    ) ?? [];
  const decoded = events.length === 1 ? decodeGuarded(events[0]!) : null;
  const event = decoded?.ok ? decoded.value : null;
  const receipt: Receipt = {
    intent: {
      id: hint.intentId,
      kind: "buy",
      ticker: token.ticker,
      issuer: token.issuer,
      asset: call.stock,
      tokenDecimals: token.decimals,
      user: tx.sender,
      recipient: call.recipient,
      spend: { asset: call.tokenIn, raw: call.amountIn, decimals: 18 },
      minShares: call.minShares,
      toleranceBps: 0,
      approvedAt: null,
      guard: tx.destination,
    },
    quote: hint.quote
      ? {
          quoteId: null,
          expectedOut: { asset: call.stock, raw: BigInt(hint.quote.tokensOut), decimals: 18 },
          route: hint.quote.routeText.split(" > "),
          router: call.router,
          observedAt: hint.quote.builtAt,
          expiresAt: hint.quote.expiresAt,
          notes: [
            "Quote and route description are unverified browser hints; comparison is client-reported",
          ],
        }
      : null,
    quoteMissingReason: hint.quote ? null : "Original quote unavailable after resuming",
    simulation: null,
    simulationMissingReason: hint.simulation?.available
      ? "Stage simulation succeeded but exposed no output amount; client-reported validation only"
      : (hint.simulation?.missingReason ?? "Simulation not recorded"),
    conversion: event
      ? {
          multiplier: event.multiplier,
          tokenDecimals: 18,
          source: "ShareGuard Guarded event",
          observationId: `${tx.hash}:${events[0]!.logIndex}`,
          observedAt: null,
          observedAtReason: "Block timestamp not supplied by transaction reader",
        }
      : null,
    conversionMissingReason: event ? null : "No unique valid Guarded event available",
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
      "Signed minimum and realized evidence read from chain; approval timestamp and tolerance choice unavailable",
    ],
  };
  return {
    kind: "swap",
    transaction: tx,
    chainReceipt: mined,
    receipt,
    result: reconcile(receipt),
    hint,
    baselineTrust: "client-hint",
    verifiedAt: now,
    verifiedFill: verifiedFill(tx, mined, call),
  };
}
