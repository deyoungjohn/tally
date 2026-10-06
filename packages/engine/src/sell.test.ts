import { describe, expect, it } from "vitest";
import { USDT_BSC } from "@tally/config";
import { BelowMinimumError, type Address, type ConsolidatedQuote } from "@tally/core";
import { prepareSell, type SellDeps } from "./sell";
import { fixtureTradeChain, fixtureWallet } from "./trade-fixture";

const USER = "0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7" as Address;
const NVDAB = "0x02fca66c1d1afb4e2a7884261eb00f63598a7436" as Address;
const ROUTER = "0xb44446b0c8e56988c34f7ff73ae904982b5fdda5" as Address;

function createMockDeps(overrides: Partial<SellDeps> = {}): SellDeps {
  const chain = fixtureTradeChain(fixtureWallet());
  return {
    api: {
      async quoteRoutes() {
        return [
          {
            quoteId: "quote-sell-123",
            executionMode: "SWAP",
            vendorName: "LiquidMesh",
            fromTokenAmount: "25654736000000000",
            toTokenAmount: "6000000000000000000",
            approveTarget: ROUTER,
            priceImpactPercent: "0.0001",
            fromToken: {
              tokenContractAddress: NVDAB,
              symbol: "NVDAB",
              decimals: 18,
              tokenUnitPrice: "233.8",
            },
            toToken: {
              tokenContractAddress: USDT_BSC,
              symbol: "USDT",
              decimals: 18,
              tokenUnitPrice: "1.0",
            },
            dexRouterList: [
              {
                toTokenIndex: 0,
                toToken: { tokenSymbol: "USDT" },
                dexProtocol: { dexName: "Elfomofi" },
              },
            ],
            routes: [
              {
                vendorName: "Elfomofi",
                fromTokenAmount: "25654736000000000",
                toTokenAmount: "6000000000000000000",
                subRoutes: [],
              },
            ],
          },
        ] as unknown as Awaited<ReturnType<SellDeps["api"]["quoteRoutes"]>>;
      },
      async swap() {
        return {
          executionMode: "SWAP",
          quoteId: "quote-sell-123",
          approveTarget: ROUTER,
          tx: {
            to: ROUTER,
            data: "0x12345678000000000000000000000000",
            minReceiveAmount: "5940000000000000000", // 1% tolerance floor
            gas: "450000",
          },
        } as unknown as Awaited<ReturnType<SellDeps["api"]["swap"]>>;
      },
      async simulate() {
        return { status: "SUCCESS" } as unknown as Awaited<ReturnType<SellDeps["api"]["simulate"]>>;
      },
    },
    chain,
    async quote() {
      return {
        ticker: "NVDA",
        amount: { usd: 6 },
        referencePrice: 233.9,
        session: "regular",
        warnings: [],
        rows: [
          {
            ticker: "NVDA",
            issuer: "bstock",
            symbol: "NVDAB",
            address: NVDAB,
            tokenPrice: 233.8,
            multiplier: {
              value: 1_000_778_223_752_807_865n,
              source: "onchain uiMultiplier",
              observedAt: Date.now(),
            },
            usdPerShare: 233.8,
            executable: true,
            ghost: false,
            unitTrap: false,
            sharesOut: 25674701000000000n,
            integrity: {
              score: 95,
              grade: "A",
              flags: [],
              reasons: [],
              checks: [],
              unitTrap: false,
            },
          },
        ],
      } as unknown as ConsolidatedQuote;
    },
    bnbUsd: async () => 600,
    reference: async () => ({ price: 233.9 }),
    now: () => 1_700_000_000_000,
    ...overrides,
  };
}

describe("prepareSell engine logic", () => {
  it("refuses a sale below $5 before calling network", async () => {
    const deps = createMockDeps();
    await expect(
      prepareSell(deps, { ticker: "NVDA", issuer: "bstock", usd: 4, user: USER }),
    ).rejects.toBeInstanceOf(BelowMinimumError);
  });

  it("refuses xStocks tokens with explicit ghost exit reason", async () => {
    const deps = createMockDeps({
      async quote() {
        return {
          ticker: "NVDA",
          rows: [
            {
              ticker: "NVDA",
              issuer: "xstocks",
              symbol: "NVDAx",
              address: "0x1111111111111111111111111111111111111111" as Address,
              ghost: true,
              multiplier: { value: 10n ** 18n },
            },
          ],
        } as unknown as ConsolidatedQuote;
      },
    });

    await expect(
      prepareSell(deps, { ticker: "NVDA", issuer: "xstocks", usd: 10, user: USER }),
    ).rejects.toThrow("No market to exit this token on BNB Chain.");
  });

  it("returns needs_funds with exact shortfall when user has insufficient stock balance", async () => {
    const chain = fixtureTradeChain(fixtureWallet());
    // User has 0 NVDAB
    chain.erc20Balances = async () => [0n];
    const deps = createMockDeps({ chain });

    const plan = await prepareSell(deps, {
      ticker: "NVDA",
      issuer: "bstock",
      tokens: "25654736000000000",
      user: USER,
    });

    expect(plan.status).toBe("needs_funds");
    expect(plan.shortfall?.tokens).toBe("25654736000000000");
    expect(plan.tx).toBeUndefined();
  });

  it("returns needs_approval with exact amount to router when allowance is insufficient", async () => {
    const chain = fixtureTradeChain(fixtureWallet());
    chain.erc20Balances = async () => [50_000_000_000_000_000n]; // has 0.05 NVDAB
    const deps = createMockDeps({
      chain,
      tokenAllowance: async () => 0n, // no allowance to router
    });

    const plan = await prepareSell(deps, {
      ticker: "NVDA",
      issuer: "bstock",
      tokens: "25654736000000000",
      user: USER,
    });

    expect(plan.status).toBe("needs_approval");
    expect(plan.approve?.to.toLowerCase()).toBe(NVDAB.toLowerCase());
    expect(plan.approve?.spender.toLowerCase()).toBe(ROUTER.toLowerCase());
    expect(plan.approve?.amount).toBe("25654736000000000");
    expect(plan.tx).toBeUndefined();
  });

  it("returns ready with direct router transaction and floor when funds and allowance are present", async () => {
    const chain = fixtureTradeChain(fixtureWallet());
    chain.erc20Balances = async () => [50_000_000_000_000_000n]; // has 0.05 NVDAB
    const deps = createMockDeps({
      chain,
      tokenAllowance: async () => 100_000_000_000_000_000n, // sufficient allowance
    });

    const plan = await prepareSell(deps, {
      ticker: "NVDA",
      issuer: "bstock",
      tokens: "25654736000000000",
      tolerancePct: 1,
      user: USER,
    });

    expect(plan.status).toBe("ready");
    expect(plan.tx?.to.toLowerCase()).toBe(ROUTER.toLowerCase());
    expect(plan.tx?.data).toBe("0x12345678000000000000000000000000");
    expect(plan.minUsdtOut).toBe("5940000000000000000");
    expect(BigInt(plan.sharesIn)).toBeGreaterThan(0n);
    expect(plan.usdPerShare).toBeGreaterThan(200);
    expect(plan.simulation?.ethCall).toBe("ok");
    expect(plan.simulation?.binance).toBe("ok");
  });

  it("calculates token amount from shares using bigint fixed point arithmetic", async () => {
    const chain = fixtureTradeChain(fixtureWallet());
    chain.erc20Balances = async () => [100_000_000_000_000_000n];
    const deps = createMockDeps({
      chain,
      tokenAllowance: async () => 100_000_000_000_000_000n,
    });

    const plan = await prepareSell(deps, {
      ticker: "NVDA",
      issuer: "bstock",
      shares: 0.025,
      user: USER,
    });

    expect(plan.status).toBe("ready");
    expect(BigInt(plan.tokensIn)).toBeGreaterThan(0n);
    // shares = tokens * m / 1e18
    expect(BigInt(plan.sharesIn)).toBeGreaterThan(24_000_000_000_000_000n);
  });

  it("handles RFQ mode gracefully with plain error", async () => {
    const chain = fixtureTradeChain(fixtureWallet());
    chain.erc20Balances = async () => [100_000_000_000_000_000n];
    const deps = createMockDeps({
      chain,
      tokenAllowance: async () => 100_000_000_000_000_000n,
      api: {
        ...createMockDeps().api,
        async quoteRoutes() {
          return [
            {
              quoteId: "rfq-1",
              executionMode: "RFQ",
              fromTokenAmount: "25654736000000000",
              toTokenAmount: "6000000000000000000",
              fromToken: { tokenUnitPrice: "233.8" },
              toToken: { tokenUnitPrice: "1.0" },
              approveTarget: ROUTER,
              dexRouterList: [],
              routes: [],
            },
          ] as unknown as Awaited<ReturnType<SellDeps["api"]["quoteRoutes"]>>;
        },
      },
    });

    await expect(
      prepareSell(deps, { ticker: "NVDA", issuer: "bstock", shares: 0.025, user: USER }),
    ).rejects.toThrow("This issuer needs a signed order. Try the other issuer.");
  });

  it("refuses sell route when router tx.to is not allow-listed", async () => {
    const foreignRouter = "0x1111111111111111111111111111111111111111" as Address;
    const deps = createMockDeps({
      api: {
        ...createMockDeps().api,
        async swap() {
          return {
            executionMode: "SWAP",
            quoteId: "q-1",
            approveTarget: ROUTER,
            tx: {
              to: foreignRouter,
              data: "0x1234",
              minReceiveAmount: "5940000000000000000",
              gas: "450000",
            },
          } as unknown as Awaited<ReturnType<SellDeps["api"]["swap"]>>;
        },
      },
    });

    await expect(
      prepareSell(deps, { ticker: "NVDA", issuer: "bstock", shares: 0.025, user: USER }),
    ).rejects.toThrow("The sell route router is not on the allow list.");
  });

  it("refuses sell route when approveTarget does not match ShareGuard configuration", async () => {
    const chain = fixtureTradeChain(fixtureWallet());
    chain.readGuard = async (s) => ({
      ...(await fixtureTradeChain(fixtureWallet()).readGuard(s, ROUTER)),
      approveTarget: "0x2222222222222222222222222222222222222222" as Address,
    });

    const deps = createMockDeps({ chain });

    await expect(
      prepareSell(deps, { ticker: "NVDA", issuer: "bstock", shares: 0.025, user: USER }),
    ).rejects.toThrow("The route's approval target doesn't match ShareGuard's configuration.");
  });

  it("refuses plan when router tx.minReceiveAmount is missing", async () => {
    const deps = createMockDeps({
      api: {
        ...createMockDeps().api,
        async swap() {
          return {
            executionMode: "SWAP",
            quoteId: "q-1",
            approveTarget: ROUTER,
            tx: {
              to: ROUTER,
              data: "0x1234",
              gas: "450000",
            },
          } as unknown as Awaited<ReturnType<SellDeps["api"]["swap"]>>;
        },
      },
    });

    await expect(
      prepareSell(deps, { ticker: "NVDA", issuer: "bstock", shares: 0.025, user: USER }),
    ).rejects.toThrow("The router did not enforce a minimum receive amount floor.");
  });

  it("refuses plan when router tx.minReceiveAmount is below tolerance floor", async () => {
    const deps = createMockDeps({
      api: {
        ...createMockDeps().api,
        async swap() {
          return {
            executionMode: "SWAP",
            quoteId: "q-1",
            approveTarget: ROUTER,
            tx: {
              to: ROUTER,
              data: "0x1234",
              minReceiveAmount: "5000000000000000000", // below 1% floor of 6e18
              gas: "450000",
            },
          } as unknown as Awaited<ReturnType<SellDeps["api"]["swap"]>>;
        },
      },
    });

    await expect(
      prepareSell(deps, { ticker: "NVDA", issuer: "bstock", shares: 0.025, user: USER }),
    ).rejects.toThrow("The router's minimum receive amount is below tolerance floor.");
  });

  it("throws invalid_request when usd sell has missing reference price", async () => {
    const deps = createMockDeps({
      reference: async () => null,
    });

    await expect(
      prepareSell(deps, { ticker: "NVDA", issuer: "bstock", usd: 25, user: USER }),
    ).rejects.toThrow("No reference price; enter shares instead.");
  });

  it("allows ticker ending in X (e.g. NFLX) when issuer is bstock", async () => {
    const chain = fixtureTradeChain(fixtureWallet());
    chain.erc20Balances = async () => [100_000_000_000_000_000n];
    const deps = createMockDeps({
      chain,
      tokenAllowance: async () => 100_000_000_000_000_000n,
      quote: async () =>
        ({
          ticker: "NFLX",
          amount: { usd: 6 },
          rows: [
            {
              ticker: "NFLX",
              issuer: "bstock",
              symbol: "NFLXB",
              address: NVDAB,
              multiplier: { value: 10n ** 18n },
              integrity: { flags: [] },
            },
          ],
        }) as unknown as ConsolidatedQuote,
    });

    const plan = await prepareSell(deps, {
      ticker: "NFLX",
      issuer: "bstock",
      shares: 0.025,
      user: USER,
    });
    expect(plan.status).toBe("ready");
    expect(plan.ticker).toBe("NFLX");
  });

  it("defaults to needs_approval and warns when allowance simulation fails", async () => {
    const chain = fixtureTradeChain(fixtureWallet());
    chain.erc20Balances = async () => [100_000_000_000_000_000n];
    chain.simulate = async (tx) => {
      // simulate allowance fails
      if (tx.data.startsWith("0xdd62ed3e")) {
        return { ok: false, reason: "execution reverted", revertData: "0x" };
      }
      return { ok: true, returnData: "0x" };
    };

    const warnings: string[] = [];
    const deps = createMockDeps({
      chain,
      onWarn: (w) => warnings.push(w),
    });

    const plan = await prepareSell(deps, {
      ticker: "NVDA",
      issuer: "bstock",
      tokens: "25654736000000000",
      user: USER,
    });

    expect(plan.status).toBe("needs_approval");
    expect(plan.warnings.some((w) => w.includes("token allowance"))).toBe(true);
    expect(warnings.some((w) => w.includes("token allowance"))).toBe(true);
  });
});
