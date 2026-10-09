export const PENDING_PIE_KEY = "tally.pendingPie";
export const PIE_RUN_TTL_MS = 24 * 60 * 60_000;
export interface PieRunLegInput {
  id: string;
  sequence: number;
  ticker: string;
  issuer: "bstock";
  symbol: string;
  amountUsdt: string;
  executable: boolean;
  reason: string | null;
}
export interface PieRunInput {
  templateId: string;
  budgetUsdt: string;
  legs: readonly PieRunLegInput[];
}
export interface PieBuyRunLeg extends PieRunLegInput {
  status: "not_started" | "pending" | "signing" | "done" | "failed";
  stage?: "planning" | "approval" | "buy";
  txHash?: string;
  approvalHash?: string;
  stock?: string;
  pendingTx?: { kind: "approval" | "buy"; hash: string };
  signatureUncertain?: boolean;
  errorKind?: string;
  receiptWarning?: string;
}
export interface PieBuyRun {
  schema: 1;
  id: string;
  wallet: string;
  templateId: string;
  budgetUsdt: string;
  createdAt: number;
  updatedAt: number;
  status: "running" | "paused" | "failed" | "done";
  legs: PieBuyRunLeg[];
}
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
export const isTxHash = (value: unknown): value is string =>
  typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
const amount = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9]{1,30}$/.test(value);

export function validatePieRunInput(value: unknown): asserts value is PieRunInput {
  if (
    !record(value) ||
    typeof value.templateId !== "string" ||
    !/^[a-z0-9-]{1,60}$/.test(value.templateId) ||
    !amount(value.budgetUsdt) ||
    !Array.isArray(value.legs) ||
    value.legs.length > 30
  )
    throw new Error("Invalid basket run data");
  const ids = new Set<string>();
  let total = 0n;
  let lastSequence = 0;
  for (const leg of value.legs) {
    if (
      !record(leg) ||
      typeof leg.id !== "string" ||
      leg.id.length > 100 ||
      ids.has(leg.id) ||
      typeof leg.sequence !== "number" ||
      !Number.isInteger(leg.sequence) ||
      leg.sequence <= lastSequence ||
      typeof leg.ticker !== "string" ||
      !/^[A-Z0-9.]{1,10}$/.test(leg.ticker) ||
      leg.issuer !== "bstock" ||
      leg.symbol !== `${leg.ticker}B` ||
      !amount(leg.amountUsdt) ||
      typeof leg.executable !== "boolean" ||
      (leg.reason !== null && typeof leg.reason !== "string")
    )
      throw new Error("Invalid basket leg data");
    ids.add(leg.id);
    lastSequence = leg.sequence;
    if (leg.executable) {
      const value = BigInt(leg.amountUsdt);
      if (value < 6n * 10n ** 18n || value > 10_000n * 10n ** 18n || value % 10n ** 16n !== 0n)
        throw new Error("Each basket buy must be a cent amount between 6 and 10000 USDT");
      total += value;
    }
  }
  if (total > BigInt(value.budgetUsdt)) throw new Error("Basket legs exceed the budget");
}

export function parsePendingPie(raw: string, wallet: string, now: number): PieBuyRun | null {
  try {
    const value: unknown = JSON.parse(raw);
    validatePieRunInput(value);
    if (
      !record(value) ||
      value.schema !== 1 ||
      typeof value.wallet !== "string" ||
      !/^0x[0-9a-fA-F]{40}$/.test(value.wallet) ||
      value.wallet.toLowerCase() !== wallet.toLowerCase() ||
      typeof value.id !== "string" ||
      typeof value.createdAt !== "number" ||
      !Number.isFinite(value.createdAt) ||
      value.createdAt > now ||
      now - value.createdAt >= PIE_RUN_TTL_MS ||
      typeof value.updatedAt !== "number" ||
      !Number.isFinite(value.updatedAt) ||
      !["running", "paused", "failed", "done"].includes(String(value.status))
    )
      return null;
    for (const leg of value.legs as unknown as Record<string, unknown>[]) {
      // Runs persist executable buys only; a deferred leg in storage is corrupt.
      if (leg.executable !== true) return null;
      if (!["not_started", "pending", "signing", "done", "failed"].includes(String(leg.status)))
        return null;
      if (leg.stage !== undefined && !["planning", "approval", "buy"].includes(String(leg.stage)))
        return null;
      if (leg.signatureUncertain !== undefined && typeof leg.signatureUncertain !== "boolean")
        return null;
      if (leg.txHash !== undefined && !isTxHash(leg.txHash)) return null;
      if (leg.approvalHash !== undefined && !isTxHash(leg.approvalHash)) return null;
      if (leg.status === "done" && !isTxHash(leg.txHash)) return null;
      if (
        leg.pendingTx !== undefined &&
        (!record(leg.pendingTx) ||
          !["approval", "buy"].includes(String(leg.pendingTx.kind)) ||
          !isTxHash(leg.pendingTx.hash))
      )
        return null;
    }
    return value as unknown as PieBuyRun;
  } catch {
    return null; // Invalid browser data is removed by the caller, never executed.
  }
}
