import { E18, mulDiv } from "@tally/core";
import {
  decodeGuarded,
  decodeRevert,
  decodeTransfer,
  GUARDED_TOPIC,
  TRANSFER_TOPIC,
} from "./decode";
import type { Conversion, Receipt, Reconciliation, TokenAmount } from "./types";
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
/** Only the display ratio is a number; amounts, conversion and thresholds stay bigint. */
export function differenceBps(actual: bigint, expected: bigint): number | null {
  return expected <= 0n ? null : Number(((actual - expected) * 100_000_000n) / expected) / 10_000;
}
export function receiptShares(tokens: bigint, conversion: Conversion): bigint {
  return mulDiv(tokens, conversion.multiplier, 10n ** BigInt(conversion.tokenDecimals));
}
export function reconcile(receipt: Receipt): Reconciliation {
  const { intent, quote, simulation, conversion, realized } = receipt;
  const result: Reconciliation = {
    status: "UNRECONCILED",
    diffVsQuoteBps: null,
    diffVsSimBps: null,
    tokensReceived: null,
    tokensSpent: null,
    sharesReceived: null,
    guarded: null,
    notes: [...receipt.notes, ...(quote?.notes ?? [])],
  };
  const reject = (reason: string): Reconciliation => {
    result.notes.push(reason);
    return result;
  };
  if (!realized || realized.status === "pending") {
    result.status = "PENDING";
    result.notes.push(
      receipt.txHash
        ? "Awaiting a mined receipt; transaction hash retained"
        : "No transaction hash recorded yet",
    );
    return result;
  }
  if (!receipt.txHash || !same(receipt.txHash, realized.txHash))
    return reject("Transaction hash does not match signed transaction");
  if (realized.status === "reverted") {
    result.status = "FAILED";
    result.notes.push(
      realized.revertData
        ? decodeRevert(realized.revertData).reason
        : "Revert data unavailable in transaction receipt",
    );
    result.notes.push(realized.failureReason ?? "Transaction reverted; cause not recorded");
    return result;
  }
  if (realized.block === null) return reject("Mined block is missing");
  if (!conversion)
    return reject(
      `Conversion unavailable: ${receipt.conversionMissingReason ?? "reason not recorded"}`,
    );
  if (!quote)
    return reject(`Quote unavailable: ${receipt.quoteMissingReason ?? "reason not recorded"}`);
  if (
    !Number.isInteger(conversion.tokenDecimals) ||
    conversion.tokenDecimals < 0 ||
    conversion.tokenDecimals > 255 ||
    intent.tokenDecimals !== conversion.tokenDecimals
  )
    return reject("Token decimals do not match the captured conversion");
  if (
    conversion.multiplier <= 0n ||
    !conversion.observationId ||
    !conversion.source ||
    (conversion.observedAt === null
      ? !conversion.observedAtReason
      : !Number.isFinite(conversion.observedAt))
  )
    return reject("Conversion observation is missing or invalid");
  if (conversion.observedAt === null)
    result.notes.push(`Conversion timestamp unavailable: ${conversion.observedAtReason}`);
  if (intent.minShares <= 0n) return reject("Signed share minimum is missing or invalid");
  const validAmount = (amount: TokenAmount) =>
    same(amount.asset, intent.asset) &&
    amount.decimals === conversion.tokenDecimals &&
    amount.raw > 0n;
  if (!validAmount(quote.expectedOut))
    return reject("Quote asset, decimals or raw amount is invalid");
  if (simulation && !validAmount(simulation.expectedOut))
    return reject("Simulation asset, decimals or raw amount is invalid");
  if (simulation && (simulation.gasLimit <= 0n || simulation.gasLimit !== realized.gasLimit))
    return reject("Simulation did not use the gas limit sent");
  if (simulation) result.notes.push(...simulation.notes);
  else {
    if (!receipt.simulationMissingReason.trim()) return reject("Missing simulation has no reason");
    result.notes.push(
      `No simulation: ${receipt.simulationMissingReason}`,
      "compared with quote; no simulation recorded",
    );
  }
  const indices = new Set<number>();
  let netReceived = 0n;
  let guardedTransfers = 0n;
  let transferCount = 0;
  let guardCount = 0;
  let netSpent = 0n;
  let spendCount = 0;
  for (const log of realized.logs) {
    if (
      log.removed ||
      !same(log.transactionHash, realized.txHash) ||
      log.blockNumber !== realized.block
    )
      return reject("Log is removed or belongs to another transaction/block");
    if (!Number.isSafeInteger(log.logIndex) || log.logIndex < 0 || indices.has(log.logIndex))
      return reject("Duplicate or invalid log index");
    indices.add(log.logIndex);
    if (same(log.address, intent.spend.asset) && same(log.topics[0] ?? "", TRANSFER_TOPIC)) {
      const decoded = decodeTransfer(log);
      if (!decoded.ok) return reject(decoded.reason);
      if (same(decoded.value.from, intent.user)) {
        netSpent += decoded.value.value;
        spendCount++;
      }
      if (same(decoded.value.to, intent.user)) netSpent -= decoded.value.value;
    }
    if (
      intent.guard &&
      same(log.address, intent.guard) &&
      same(log.topics[0] ?? "", GUARDED_TOPIC)
    ) {
      const decoded = decodeGuarded(log);
      if (!decoded.ok) return reject(decoded.reason);
      guardCount++;
      result.guarded = decoded.value;
    }
    if (same(log.address, intent.asset) && same(log.topics[0] ?? "", TRANSFER_TOPIC)) {
      const decoded = decodeTransfer(log);
      if (!decoded.ok) return reject(decoded.reason);
      const transfer = decoded.value;
      if (same(transfer.to, intent.recipient)) {
        transferCount++;
        netReceived += transfer.value;
        if (intent.guard && same(transfer.from, intent.guard)) guardedTransfers += transfer.value;
      }
      if (same(transfer.from, intent.recipient)) netReceived -= transfer.value;
    }
  }
  if (!transferCount || netReceived <= 0n)
    return reject("Missing Transfer evidence for the expected asset and recipient");
  const shares = receiptShares(netReceived, conversion);
  if (intent.guard) {
    const event = result.guarded;
    if (guardCount !== 1 || !event)
      return reject("Expected exactly one Guarded event from the signed guard");
    if (
      !same(event.stock, intent.asset) ||
      !same(event.user, intent.user) ||
      !same(event.recipient, intent.recipient) ||
      !same(event.tokenIn, intent.spend.asset) ||
      event.amountIn !== intent.spend.raw ||
      !same(event.router, quote.router)
    )
      return reject("Guarded event does not match signed intent/route");
    // ShareGuard v1 assumes raw units are 1e18; mismatched decimal claims cannot pass.
    if (
      conversion.tokenDecimals !== 18 ||
      event.multiplier !== conversion.multiplier ||
      event.shares !== mulDiv(event.tokensOut, event.multiplier, E18)
    )
      return reject("Guarded share conversion does not match the frozen observation");
    if (
      event.tokensOut !== netReceived ||
      event.tokensOut !== guardedTransfers ||
      event.shares !== shares
    )
      return reject("Transfer evidence does not explain Guarded output");
  }
  result.tokensReceived = netReceived;
  if (spendCount && netSpent > 0n && netSpent <= intent.spend.raw) result.tokensSpent = netSpent;
  else
    result.notes.push(
      "Net spend Transfer evidence unavailable or invalid; US reference comparison unavailable",
    );
  result.sharesReceived = shares;
  result.diffVsQuoteBps = differenceBps(netReceived, quote.expectedOut.raw);
  result.diffVsSimBps = simulation ? differenceBps(netReceived, simulation.expectedOut.raw) : null;
  if (shares < intent.minShares) return reject("Received shares are below the signed minimum");
  const baseline = simulation?.expectedOut.raw ?? quote.expectedOut.raw;
  const delta = netReceived > baseline ? netReceived - baseline : baseline - netReceived;
  result.status = delta * 10_000n <= baseline ? "RECONCILED" : "RECONCILED_WITH_DIFFERENCE";
  if (result.status === "RECONCILED_WITH_DIFFERENCE")
    result.notes.push("Fill differs from the comparison amount; cause not recorded");
  return result;
}
