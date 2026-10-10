import { formatUnits, parseUnits } from "viem";
import { dec3 } from "../receipt-format";

export interface LegVM {
  verified: boolean;
  tokenSymbol: string;
  tokenAmount: string | null;
  shares: string | null;
  sharesLabel?: string;
  /** True when the shares were worked out with today's multiplier rather than the one recorded at the time. */
  sharesAtTodaysMultiplier?: boolean;
  usdValue: string | null;

  route: string;
  vendor: string;
  quoteTime: number | null;
  simulation: boolean | null;
  txHash: string;
  blockNumber: number | null;
  gasUsed: number | null;
  gasUsd: number | null;

  protectionLabel: string;
  protectionValue: string | null;
  protectionPass: boolean;
}

export interface MigrateReceiptVM {
  giveUp: LegVM;
  receive: LegVM;
  shareDiff: {
    label: string;
    diff: string;
    isDown: boolean;
    approximate?: boolean;
  } | null;
  dollarDiff: {
    diff: string;
    isDown: boolean;
  } | null;
  isFixture: boolean;
}

export interface LegInput {
  hash: string;
  tokenSymbol: string;
  isFixture: boolean;

  plan?: {
    route: string;
    vendor: string;
    quoteTime: number | null;
    simulation: boolean | null;
  };

  // common
  multiplier?: string;
  isTodayMultiplier?: boolean;

  // sell specific
  sellGuaranteedUsdt?: string;
  sellTokensSpent?: string; // from receipt
  sellUsdtReceived?: string; // from receipt

  // buy specific
  buyMinShares?: string;
  buyTokensReceived?: string; // from receipt
  buyUsdtSpent?: string; // from receipt

  blockNumber?: number;
  gasUsed?: number;
  gasUsd?: number;
}

/** A share difference to 3 decimals; one that rounds to nothing reads "0". */
function signedDec3(value: string, isDown: boolean): string {
  const r = dec3(value) ?? value;
  if (/^-?0(\.0+)?$/.test(r)) return "0";
  return (isDown ? "" : "+") + r;
}

export function buildMigrateReceipt(sell: LegInput, buy: LegInput): MigrateReceiptVM {
  const isFixture = sell.isFixture || buy.isFixture;

  const giveUp: LegVM = {
    verified: !!sell.sellTokensSpent,
    tokenSymbol: sell.tokenSymbol,
    tokenAmount: sell.sellTokensSpent ? formatUnits(BigInt(sell.sellTokensSpent), 18) : null,
    shares: null,
    usdValue: sell.sellUsdtReceived ? formatUnits(BigInt(sell.sellUsdtReceived), 18) : null,
    route: sell.plan?.route ?? "Not recorded on chain",
    vendor: sell.plan?.vendor ?? "Not recorded on chain",
    quoteTime: sell.plan?.quoteTime ?? null,
    simulation: sell.plan?.simulation ?? null,
    txHash: sell.hash,
    blockNumber: sell.blockNumber ?? null,
    gasUsed: sell.gasUsed ?? null,
    gasUsd: sell.gasUsd ?? null,
    protectionLabel: "Guaranteed at least",
    protectionValue: sell.sellGuaranteedUsdt
      ? formatUnits(BigInt(sell.sellGuaranteedUsdt), 18)
      : null,
    protectionPass: false,
  };

  if (sell.sellTokensSpent && sell.multiplier) {
    const tokens = BigInt(sell.sellTokensSpent);
    const m = BigInt(sell.multiplier);
    giveUp.shares = formatUnits((tokens * m) / 1000000000000000000n, 18);
    if (sell.isTodayMultiplier) {
      giveUp.sharesLabel = "Shares";
      giveUp.sharesAtTodaysMultiplier = true;
    }
  }

  if (sell.sellUsdtReceived && sell.sellGuaranteedUsdt) {
    giveUp.protectionPass = BigInt(sell.sellUsdtReceived) >= BigInt(sell.sellGuaranteedUsdt);
  }

  const receive: LegVM = {
    verified: !!buy.buyTokensReceived,
    tokenSymbol: buy.tokenSymbol,
    tokenAmount: buy.buyTokensReceived ? formatUnits(BigInt(buy.buyTokensReceived), 18) : null,
    shares: null,
    usdValue: buy.buyUsdtSpent ? formatUnits(BigInt(buy.buyUsdtSpent), 18) : null,
    route: buy.plan?.route ?? "Not recorded on chain",
    vendor: buy.plan?.vendor ?? "Not recorded on chain",
    quoteTime: buy.plan?.quoteTime ?? null,
    simulation: buy.plan?.simulation ?? null,
    txHash: buy.hash,
    blockNumber: buy.blockNumber ?? null,
    gasUsed: buy.gasUsed ?? null,
    gasUsd: buy.gasUsd ?? null,
    protectionLabel: "Guaranteed at least",
    protectionValue: buy.buyMinShares ? formatUnits(BigInt(buy.buyMinShares), 18) : null,
    protectionPass: false,
  };

  if (buy.buyTokensReceived && buy.multiplier) {
    const tokens = BigInt(buy.buyTokensReceived);
    const m = BigInt(buy.multiplier);
    receive.shares = formatUnits((tokens * m) / 1000000000000000000n, 18);
    if (buy.isTodayMultiplier) {
      receive.sharesLabel = "Shares";
      receive.sharesAtTodaysMultiplier = true;
    }
  }

  if (receive.shares && buy.buyMinShares) {
    receive.protectionPass = BigInt(parseUnits(receive.shares, 18)) >= BigInt(buy.buyMinShares);
  }

  let shareDiff = null;
  if (giveUp.tokenAmount && giveUp.shares && receive.tokenAmount && receive.shares) {
    const sharesIn = parseUnits(giveUp.shares, 18);
    const sharesOut = parseUnits(receive.shares, 18);
    const diff = sharesOut - sharesIn;
    const isDown = diff < 0n;

    // Formatting correctly, up to 4 decimals maybe? We'll just show the full precision or formatted.
    const fmtIn = formatUnits(sharesIn, 18);
    const fmtOut = formatUnits(sharesOut, 18);
    // Remove trailing zeros to match standard display or keep standard formatting?
    // Let's use Number() formatting for the label to make it readable.
    const fIn = dec3(fmtIn);
    const fOut = dec3(fmtOut);

    shareDiff = {
      label: `${fIn} ${giveUp.tokenSymbol} = ${fIn} shares to ${fOut} ${receive.tokenSymbol} = ${fOut} shares`,
      diff: signedDec3(formatUnits(diff, 18), isDown),
      isDown,
      approximate: !!(sell.isTodayMultiplier || buy.isTodayMultiplier),
    };
  }

  let dollarDiff = null;
  if (sell.sellUsdtReceived && buy.buyUsdtSpent) {
    const inUsd = BigInt(sell.sellUsdtReceived);
    const outUsd = BigInt(buy.buyUsdtSpent);
    const diffWei = inUsd - outUsd;
    const isDown = diffWei < 0n;
    const absDiff = isDown ? -diffWei : diffWei;

    // Convert to cents (1e16 wei) rounding down, then to dollar string
    const cents = absDiff / 10000000000000000n;
    const dollars = cents / 100n;
    const remainder = cents % 100n;
    let diffStr = (isDown ? "-" : "+") + `$${dollars}.${remainder.toString().padStart(2, "0")}`;

    if (sell.gasUsd !== undefined && buy.gasUsd !== undefined) {
      const totalGas = sell.gasUsd + buy.gasUsd;
      diffStr += ` (minus $${totalGas.toFixed(2)} gas)`;
    }

    dollarDiff = {
      diff: diffStr,
      isDown,
    };
  }

  return { giveUp, receive, shareDiff, dollarDiff, isFixture };
}
