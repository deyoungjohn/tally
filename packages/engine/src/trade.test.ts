import { decodeFunctionData, encodeErrorResult, recoverTypedDataAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { SHAREGUARD_DEPLOYED, USDT_BSC } from "@tally/config";
import { BelowMinimumError, type Address } from "@tally/core";
import { SHAREGUARD_ABI, decodeGuardRevert, feedUpdateTypedData } from "@tally/chain";
import { createFixtureEngine } from "./engine";
import { TradeError, type FeedSigner, type TradePlan } from "./trade";
import {
  FIXTURE_APPROVE_HASH,
  FIXTURE_SWAP_HASH,
  fixtureTradeChain,
  fixtureWallet,
} from "./trade-fixture";

const USER = "0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7" as Address;
// A public test constant (the fork tests use 0xFEED5 the same way), never a real key.
const TEST_PK = `0x${"feed5".padStart(64, "0")}` as Hex;
const testSigner = (): FeedSigner => {
  const a = privateKeyToAccount(TEST_PK);
  return {
    address: a.address as Address,
    signUpdate: (guard, u) => a.signTypedData(feedUpdateTypedData(guard, u)),
  };
};
const funded = (allowance = 0n) => fixtureTradeChain({ ...fixtureWallet(), allowance });
const approved = () => funded(10n ** 24n);
const buy = (e: ReturnType<typeof createFixtureEngine>, issuer: "ondo" | "bstock", usd = 6) =>
  e.trade.prepare({ ticker: "NVDA", issuer, usd, user: USER });

describe("trade plan (blueprint §7.6), on recorded quotes and swap builds", () => {
  it("refuses below $6 before anything is called", async () => {
    await expect(buy(createFixtureEngine(), "ondo", 5)).rejects.toBeInstanceOf(BelowMinimumError);
  });

  it("an empty wallet gets `needs_funds` with the exact shortfall (the top-up flow), and no transaction", async () => {
    const chain = fixtureTradeChain({ usdt: 0n, bnb: 0n, allowance: 0n });
    const p = await buy(createFixtureEngine({ tradeChain: chain }), "bstock");
    expect(p.status).toBe("needs_funds");
    expect(p.shortfall!.usdt).toBe((6n * 10n ** 18n).toString());
    expect(BigInt(p.shortfall!.bnb)).toBeGreaterThan(0n);
    expect(p.tx).toBeUndefined();
    expect(p.approve).toBeUndefined();
  });

  it("without allowance it asks for an EXACT-amount approval to ShareGuard (never unlimited)", async () => {
    const p = await buy(createFixtureEngine({ tradeChain: funded() }), "bstock");
    expect(p.status).toBe("needs_approval");
    expect(p.approve!.to.toLowerCase()).toBe(USDT_BSC.toLowerCase());
    // approve(address,uint256): selector 0x095ea7b3, guard, 6e18
    expect(p.approve!.data.slice(0, 10)).toBe("0x095ea7b3");
    expect(p.approve!.data.toLowerCase()).toContain(SHAREGUARD_DEPLOYED.slice(2).toLowerCase());
    expect(BigInt("0x" + p.approve!.data.slice(-64))).toBe(6n * 10n ** 18n);
    expect(p.tx).toBeUndefined();
  });

  it("is ready for a bStock buy: guard calldata, minShares 1% under quoted, gas = estimate × 1.25 (not the API's 450000)", async () => {
    const p = await buy(createFixtureEngine({ tradeChain: approved() }), "bstock");
    expect(p.status).toBe("ready");
    expect(p.tx!.to).toBe(SHAREGUARD_DEPLOYED);
    expect(p.tx!.data.slice(0, 10)).not.toBe("0x095ea7b3");
    expect(p.tx!.gasEstimate).toBe("554149");
    expect(p.tx!.gasLimit).toBe("692687"); // ceil(554149 × 1.25), the limit sent in live buy F11 #1
    expect(Number(p.tx!.gasLimit)).toBeGreaterThan(450_000);
    expect(p.feedUpdate).toBe(false);
    const quoted = BigInt(p.quotedShares);
    expect(BigInt(p.minShares)).toBe((quoted * 9900n) / 10000n);
    expect(p.symbol).toBe("NVDAB");
    expect(p.simulation).toMatchObject({ ethCall: "ok" });
    expect(p.expiresAt - p.builtAt).toBe(15_000);
    expect(p.premium).not.toBeNull();
    expect(Math.abs(p.premium!)).toBeLessThan(0.01);
    expect(p.routeText).toMatch(/^USDT → /);
    expect(p.tx!.feeUsd).toBeGreaterThan(0.005);
  });

  it("builds the calldata for the guard's address and the user as recipient", async () => {
    const p = await buy(createFixtureEngine({ tradeChain: approved() }), "bstock");
    expect(p.tx!.data.toLowerCase()).toContain(USER.slice(2).toLowerCase());
  });

  it("Ondo: when the guard already holds the engine's multiplier the buy carries no signed update", async () => {
    const p = await buy(createFixtureEngine({ tradeChain: approved(), signer: testSigner() }), "ondo");
    expect(p.status).toBe("ready");
    expect(p.symbol).toBe("NVDAon");
    expect(p.feedUpdate).toBe(false);
  });

  it("Ondo with a stale on-chain feed carries a bounded signed update the guard can verify", async () => {
    const chain = approved();
    const stale = {
      ...chain,
      readGuard: async (s: Address, r: Address) => ({
        ...(await chain.readGuard(s, r)),
        sharesPerToken: undefined,
        sharesPerTokenError: "FeedStale",
      }),
    };
    const signer = testSigner();
    const p = await buy(createFixtureEngine({ tradeChain: stale, signer }), "ondo");
    expect(p.feedUpdate).toBe(true);
    const d = decodeFunctionData({ abi: SHAREGUARD_ABI, data: p.tx!.data });
    expect(d.functionName).toBe("swapForSharesWithFeed");
    const args = d.args as unknown as readonly [
      Address, bigint, Address, bigint, Address, Hex, Address, bigint,
      { stock: Address; multiplier: bigint; validAfter: bigint; validUntil: bigint },
      Hex,
    ];
    const [, , stock, minShares, , , recipient, , update, sig] = args;
    expect(stock.toLowerCase()).toBe(p.stock);
    expect(minShares).toBe(BigInt(p.minShares));
    expect(recipient).toBe(USER);
    expect(update.multiplier).toBe(BigInt(p.multiplier));
    expect(update.validUntil - update.validAfter).toBe(930n);
    // The signature recovers to the signer, so the contract's ECDSA check will accept it.
    const who = await recoverTypedDataAddress({
      ...feedUpdateTypedData(SHAREGUARD_DEPLOYED, update),
      signature: sig,
    });
    expect(who).toBe(signer.address);
  });

  it("Ondo with a stale feed and NO signer is refused, never guessed", async () => {
    const chain = approved();
    const stale = {
      ...chain,
      readGuard: async (s: Address, r: Address) => ({
        ...(await chain.readGuard(s, r)),
        sharesPerToken: undefined,
        sharesPerTokenError: "FeedStale",
      }),
    };
    await expect(buy(createFixtureEngine({ tradeChain: stale }), "ondo")).rejects.toMatchObject({
      kind: "feed_stale",
    });
  });

  it("a simulation revert InsufficientShares is shown as 'price moved', and no transaction is returned", async () => {
    const data = encodeErrorResult({
      abi: SHAREGUARD_ABI,
      errorName: "InsufficientShares",
      args: [1n, 2n],
    });
    const chain = fixtureTradeChain({ ...fixtureWallet(), allowance: 10n ** 24n, simulateRevert: data });
    expect(decodeGuardRevert(data)?.name).toBe("InsufficientShares");
    const err = await buy(createFixtureEngine({ tradeChain: chain }), "bstock").catch((e) => e);
    expect(err).toBeInstanceOf(TradeError);
    expect(err.kind).toBe("price_moved");
    expect(err.message).toMatch(/price moved more than your tolerance/i);
  });

  it("a paused token is refused with the corporate-action message", async () => {
    const chain = fixtureTradeChain({ ...fixtureWallet(), allowance: 10n ** 24n, tokenPaused: true });
    await expect(buy(createFixtureEngine({ tradeChain: chain }), "bstock")).rejects.toMatchObject({
      kind: "token_paused",
    });
  });

  it("a ghost-market token is not buyable (NFLX Ondo had $16 of volume)", async () => {
    const e = createFixtureEngine({ tradeChain: approved() });
    await expect(
      e.trade.prepare({ ticker: "NFLX", issuer: "ondo", usd: 6, user: USER }),
    ).rejects.toMatchObject({ kind: "not_buyable" });
  });
});

describe("receipt in shares (blueprint §7.6 step 8)", () => {
  it("is pending until mined, then decodes the Guarded event into shares, $/share and premium", async () => {
    const e = createFixtureEngine({ tradeChain: approved() });
    expect((await e.trade.receipt("0x" + "11".repeat(32) as Hex, "NVDA")).status).toBe("pending");
    const r = await e.trade.receipt(FIXTURE_SWAP_HASH, "NVDA");
    expect(r.status).toBe("success");
    expect(BigInt(r.fill!.shares)).toBe(25_704_894_000_000_000n);
    expect(r.fill!.usdPerShare).toBeCloseTo(6 / 0.025704894, 2);
    expect(r.fill!.premium).not.toBeNull();
    expect(r.gasUsed).toBe(648_385);
    expect(r.bscscan).toBe(`https://bscscan.com/tx/${FIXTURE_SWAP_HASH}`);
  });
  it("the approve pseudo-hash raises the allowance so the next plan is ready", async () => {
    const chain = funded();
    const e = createFixtureEngine({ tradeChain: chain });
    expect(((await buy(e, "bstock")) as TradePlan).status).toBe("needs_approval");
    await e.trade.receipt(FIXTURE_APPROVE_HASH);
    expect((await buy(e, "bstock")).status).toBe("ready");
  });
});
