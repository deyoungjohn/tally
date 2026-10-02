#!/usr/bin/env tsx
import { BinanceApiError } from "@tally/binance";
import { BelowMinimumError } from "@tally/core";
import { createFixtureEngine, createLiveEngine, type Engine } from "./engine";
import { formatQuote } from "./format";

const HELP = `tally: compare one US stock across the issuers on BNB Chain, in shares.

  tally quote <TICKER> <amount> [--shares] [--fixtures] [--blocked] [--json]
  tally ladder <TICKER> [--fixtures]            quotes at 6, 25, 100 and 1000 USDT

  <amount> is dollars (USDT), or shares with --shares. Minimum order 6 USDT.
  --fixtures  answer from recorded fixtures (works anywhere); without it the live API is used (Seoul EC2 only).
  --blocked   with --fixtures: simulate a region-blocked caller (40304).
  Live mode reads BINANCE_W3_API_KEY, BINANCE_W3_API_SECRET and optionally BSC_RPC_PRIMARY from the environment.`;

function engineFor(flags: Set<string>): Engine {
  const onWarn = (m: string) => console.error(`warning: ${m}`);
  return flags.has("--fixtures")
    ? createFixtureEngine({ blockRegion: flags.has("--blocked"), onWarn })
    : createLiveEngine(process.env, onWarn);
}

async function main(argv: string[]): Promise<number> {
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const args = argv.filter((a) => !a.startsWith("--"));
  const [cmd, ticker, amountStr] = args;
  if (!cmd || cmd === "help" || flags.has("--help")) {
    console.log(HELP);
    return cmd ? 0 : 1;
  }
  try {
    if (cmd === "quote") {
      const n = Number(amountStr);
      if (!ticker || !Number.isFinite(n) || n <= 0) {
        console.error("usage: tally quote <TICKER> <amount> [--shares]");
        return 2;
      }
      const q = await engineFor(flags).quote({
        ticker,
        amount: flags.has("--shares") ? { shares: n } : { usd: n },
      });
      console.log(
        flags.has("--json")
          ? JSON.stringify(q, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2)
          : formatQuote(q),
      );
      return 0;
    }
    if (cmd === "ladder") {
      if (!ticker) return (console.error("usage: tally ladder <TICKER>"), 2);
      const engine = engineFor(flags);
      for (const usd of [6, 25, 100, 1000]) {
        console.log(formatQuote(await engine.quote({ ticker, amount: { usd } })), "\n");
      }
      return 0;
    }
    console.error(HELP);
    return 2;
  } catch (e) {
    if (e instanceof BelowMinimumError)
      console.error(
        `${e.message}. (Ondo checks $5 in dollars and USDT is ~$0.9995, so 6 USDT is the floor.)`,
      );
    else if (e instanceof BinanceApiError && e.kind === "region_block")
      console.error(
        `Quotes are unavailable: Binance refused this server's IP (code ${e.code}). Run on the Seoul EC2. Ops: this is region drift (blueprint §14).`,
      );
    else console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
}

process.exitCode = await main(process.argv.slice(2));
