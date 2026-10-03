import { E18, mulDiv } from "@tally/core";
import type { MultiplierObservation, ToSharesResult } from "./types";

export interface ToSharesLine {
  amountTokens: bigint;
  decimals?: number;
  tradeTime?: number;
}

/**
 * toShares(line, multiplierObservation | null, todaysRatio?):
 * Performs exact 1e18 fixed point bigint math.
 * When multiplierObservation is provided and valid, uses it and sets convertedAtTodaysRatio: false.
 * When no observation exists (null/undefined), falls back to today's ratio and sets convertedAtTodaysRatio: true.
 */
export function toShares(
  line: ToSharesLine | bigint,
  multiplierObservation: MultiplierObservation | bigint | null | undefined,
  todaysRatio: bigint = E18,
): ToSharesResult {
  const amountTokens = typeof line === "bigint" ? line : line.amountTokens;
  const decimals = typeof line === "bigint" ? 18 : (line.decimals ?? 18);
  const baseDecimals = 10n ** BigInt(decimals);

  let multiplier: bigint;
  let convertedAtTodaysRatio: boolean;

  if (typeof multiplierObservation === "bigint" && multiplierObservation > 0n) {
    multiplier = multiplierObservation;
    convertedAtTodaysRatio = false;
  } else if (
    multiplierObservation &&
    typeof multiplierObservation === "object" &&
    typeof multiplierObservation.multiplier === "bigint" &&
    multiplierObservation.multiplier > 0n
  ) {
    multiplier = multiplierObservation.multiplier;
    convertedAtTodaysRatio = false;
  } else {
    multiplier = todaysRatio > 0n ? todaysRatio : E18;
    convertedAtTodaysRatio = true;
  }

  const amountShares = mulDiv(amountTokens, multiplier, baseDecimals);

  return {
    amountShares,
    multiplier,
    convertedAtTodaysRatio,
  };
}
