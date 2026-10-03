import { mulDiv } from "@tally/core";
import type { MultiplierObservation, ToSharesResult } from "./types";

export interface ToSharesLine {
  amountTokens: bigint;
  decimals?: number;
  tradeTime?: number;
}

/**
 * toShares(line, multiplierObservation, todaysRatio):
 * Performs exact 1e18 fixed point bigint math.
 * When multiplierObservation is provided (> 0n), uses it and sets convertedAtTodaysRatio: false.
 * When no observation exists, uses todaysRatio (> 0n) and sets convertedAtTodaysRatio: true.
 * When neither exists, returns amountShares: null, multiplier: null, convertedAtTodaysRatio: false,
 * and sharesUnavailableReason. Never silently defaults to 1 share per token.
 */
export function toShares(
  line: ToSharesLine | bigint,
  multiplierObservation?: MultiplierObservation | bigint | null,
  todaysRatio?: bigint | null,
): ToSharesResult {
  const amountTokens = typeof line === "bigint" ? line : line.amountTokens;
  const decimals = typeof line === "bigint" ? 18 : (line.decimals ?? 18);
  const baseDecimals = 10n ** BigInt(decimals);

  let multiplier: bigint | null = null;
  let convertedAtTodaysRatio = false;

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
  } else if (todaysRatio !== undefined && todaysRatio !== null && todaysRatio > 0n) {
    multiplier = todaysRatio;
    convertedAtTodaysRatio = true;
  }

  if (multiplier === null) {
    return {
      amountShares: null,
      multiplier: null,
      convertedAtTodaysRatio: false,
      sharesUnavailableReason: "Multiplier unavailable from observation or current registry ratio",
    };
  }

  const amountShares = mulDiv(amountTokens, multiplier, baseDecimals);

  return {
    amountShares,
    multiplier,
    convertedAtTodaysRatio,
  };
}
