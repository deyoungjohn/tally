import { formatUnits, parseUnits } from "viem";

export interface LegVM {
  verified: boolean;
  tokenSymbol: string;
  tokenAmount: string | null;
  shares: string | null;
  usdValue: string | null;

  route: string;
  vendor: string;
  quoteTime: number | null;
  simulation: boolean | null;
  txHash: string;
  blockNumber: number | null;
  gasUsed: number | null;

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
    protectionLabel: "Guaranteed at least",
    protectionValue: buy.buyMinShares ? formatUnits(BigInt(buy.buyMinShares), 18) : null,
    protectionPass: false,
  };

  if (buy.buyTokensReceived && buy.multiplier) {
    const tokens = BigInt(buy.buyTokensReceived);
    const m = BigInt(buy.multiplier);
    receive.shares = formatUnits((tokens * m) / 1000000000000000000n, 18);
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
    const fIn = parseFloat(fmtIn);
    const fOut = parseFloat(fmtOut);

    shareDiff = {
      label: `${fIn} ${giveUp.tokenSymbol} = ${fIn} shares to ${fOut} ${receive.tokenSymbol} = ${fOut} shares`,
      diff: (isDown ? "" : "+") + parseFloat(formatUnits(diff, 18)).toString(),
      isDown,
    };
  }

  let dollarDiff = null;
  if (sell.sellUsdtReceived && buy.buyUsdtSpent) {
    const inUsd = BigInt(sell.sellUsdtReceived);
    const outUsd = BigInt(buy.buyUsdtSpent);
    // Diff is (out - in). Positive means we got more shares value, but wait:
    // "USDT out of leg 1 vs USDT spent in leg 2, plus the two fees"
    // So dollar difference = (leg 2 spent USDT - leg 1 received USDT) - sell fee - buy fee
    // outUsd is leg 2 spent, inUsd is leg 1 received
    let netGain = Number(formatUnits(outUsd - inUsd, 18));
    if (sell.gasUsd) netGain -= sell.gasUsd;
    if (buy.gasUsd) netGain -= buy.gasUsd;

    const isDown = netGain < 0;
    dollarDiff = {
      diff: (isDown ? "" : "+") + netGain.toFixed(2),
      isDown,
    };
  }

  return { giveUp, receive, shareDiff, dollarDiff, isFixture };
}
