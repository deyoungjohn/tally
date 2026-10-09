import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { SellPlan } from "@tally/engine";
import { useSellFlow, parseShares, type SellTarget } from "./use-sell-flow";

// A minimal DOM for React 19 in Node, the same approach as use-trade-flow.test.ts.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
class HTMLElement {}
class HTMLIFrameElement extends HTMLElement {}
(globalThis as unknown as { HTMLElement: unknown }).HTMLElement = HTMLElement;
(globalThis as unknown as { HTMLIFrameElement: unknown }).HTMLIFrameElement = HTMLIFrameElement;

function mockDom() {
  const mockEl: Record<string, unknown> = {
    nodeType: 1,
    tagName: "DIV",
    style: {},
    firstChild: null,
    lastChild: null,
    childNodes: [],
    removeChild: () => {},
    appendChild: () => {},
    insertBefore: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    setAttribute: () => {},
    removeAttribute: () => {},
  };
  const doc = {
    nodeType: 9,
    defaultView: globalThis,
    createElement: () => mockEl,
    createElementNS: () => mockEl,
    createTextNode: (t: string) => ({ nodeType: 3, textContent: t }),
    createComment: () => ({ nodeType: 8 }),
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  mockEl.ownerDocument = doc;
  return { mockEl, doc };
}
(globalThis as unknown as { window: unknown }).window = globalThis;

const storage = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => storage.set(k, v),
  removeItem: (k: string) => storage.delete(k),
  clear: () => storage.clear(),
};

let wallet = {
  ready: true,
  authenticated: true,
  address: "0x1111111111111111111111111111111111111111" as `0x${string}`,
  sendTx: vi.fn(),
};
vi.mock("@/components/wallet/wallet-context", () => ({ useTallyWallet: () => wallet }));
const fetchSellPlan = vi.fn();
vi.mock("../../lib/trade-plan/sell", async (orig) => ({
  ...(await orig<typeof import("../../lib/trade-plan/sell")>()),
  fetchSellPlan: (p: unknown) => fetchSellPlan(p),
}));

const HASH = `0x${"ab".repeat(32)}`;
const STOCK = "0x02fca66c1d1afb4e2a7884261eb00f63598a7436" as const;
const ROUTER = "0xb44446b0c8e56988c34f7ff73ae904982b5fdda5" as const;
const RAW_BALANCE = "25654736123456789"; // not representable as a float round trip

const target: SellTarget = {
  ticker: "NVDA",
  issuer: "bstock",
  symbol: "NVDAB",
  probeShares: 0.0257,
};

function plan(over: Partial<SellPlan> = {}): SellPlan {
  return {
    status: "ready",
    builtAt: Date.now(),
    expiresAt: Date.now() + 15_000,
    ticker: "NVDA",
    issuer: "bstock",
    symbol: "NVDAB",
    stock: STOCK,
    user: wallet.address,
    tolerancePct: 1,
    tokensIn: "10000000000000000",
    sharesIn: "10007780000000000",
    quotedUsdtOut: "2340000000000000000",
    minUsdtOut: "2316600000000000000",
    floorSource: "router",
    multiplier: "1000778000000000000",
    usdPerShare: 233.8,
    referencePrice: 233.9,
    routeText: "NVDAB → USDT",
    hops: 1,
    vendor: "LiquidMesh",
    balances: { tokens: RAW_BALANCE, bnb: "100000000000000000" },
    tx: {
      to: ROUTER,
      data: "0xabcdef",
      value: "0x0",
      gasEstimate: "300000",
      gasLimit: "375000",
      gasPriceWei: "3000000000",
      feeUsd: 0.03,
      chainId: 56,
    },
    simulation: { ethCall: "ok", binance: "ok" },
    warnings: [],
    ...over,
  };
}

function mount() {
  const { mockEl, doc } = mockDom();
  (globalThis as unknown as { document: unknown }).document = doc;
  let flow: ReturnType<typeof useSellFlow> = null!;
  function Comp() {
    flow = useSellFlow();
    return null;
  }
  const root = createRoot(mockEl as unknown as Parameters<typeof createRoot>[0]);
  act(() => root.render(createElement(Comp)));
  return { flow: () => flow, unmount: () => act(() => root.unmount()) };
}

const flush = () => act(async () => void (await vi.advanceTimersByTimeAsync(600)));

async function openAndType(h: ReturnType<typeof mount>, text = "0.01") {
  await act(async () => void (await h.flow().open(target)));
  await flush();
  await act(async () => h.flow().setInputs({ text }));
  await flush();
}

const fetchedUrls: string[] = [];
/** Every body POSTed to /api/receipts (the fire-and-forget hint). */
const hints: Record<string, unknown>[] = [];
let receiptsReply: "ok" | "404" | "throw" = "ok";
function stubStatus(status: "success" | "reverted" | "pending" = "success") {
  globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: { body?: string }) => {
    if (url === "/api/receipts") {
      hints.push(JSON.parse(init?.body ?? "{}"));
      if (receiptsReply === "throw") throw new Error("network down");
      return { ok: receiptsReply === "ok", status: receiptsReply === "ok" ? 200 : 404 };
    }
    fetchedUrls.push(url);
    return {
      ok: true,
      json: async () => ({
        status,
        hash: HASH,
        blockNumber: 42,
        gasUsed: 280000,
        bscscan: `https://bscscan.com/tx/${HASH}`,
      }),
    };
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  storage.clear();
  fetchedUrls.length = 0;
  hints.length = 0;
  receiptsReply = "ok";
  fetchSellPlan.mockReset();
  wallet = {
    ready: true,
    authenticated: true,
    address: "0x1111111111111111111111111111111111111111",
    sendTx: vi.fn().mockResolvedValue(HASH),
  };
  stubStatus();
});
afterEach(() => {
  vi.useRealTimers();
  storage.clear();
});

describe("parseShares", () => {
  it("accepts a positive amount with up to 8 decimals and nothing else", () => {
    expect(parseShares("0.025")).toBe(0.025);
    expect(parseShares("1")).toBe(1);
    for (const bad of ["", ".", "0", "0.000000001", "-1", "1e3", "abc"])
      expect(parseShares(bad)).toBeNull();
  });
});

describe("useSellFlow", () => {
  it("opening checks the token once; a refusal is shown in plain words, never as raw text", async () => {
    fetchSellPlan.mockRejectedValueOnce(
      Object.assign(
        new Error("No market to exit this token on BNB Chain. (https://internal.example/x)"),
        {
          kind: "not_buyable",
        },
      ),
    );
    const h = mount();
    await act(async () => void (await h.flow().open(target)));
    const p = h.flow().phase;
    expect(p.name).toBe("refused");
    if (p.name === "refused") {
      expect(p.failure.message).toBe("No market to exit this token on BNB Chain.");
      expect(p.failure.message).not.toMatch(/http/);
    }
    h.unmount();
  });

  it("Sell all re-requests with the raw token balance string from the plan, never a number", async () => {
    fetchSellPlan.mockResolvedValue(plan({ tokensIn: RAW_BALANCE }));
    const h = mount();
    await act(async () => void (await h.flow().open(target)));
    await act(async () => h.flow().sellAll());
    await flush();
    const last = fetchSellPlan.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(last.tokens).toBe(RAW_BALANCE);
    expect(typeof last.tokens).toBe("string");
    expect(last.shares).toBeUndefined();
    expect(last.usd).toBeUndefined();
    h.unmount();
  });

  it("confirm requests a fresh plan first and signs exactly that plan's transaction", async () => {
    const first = plan();
    const fresh = plan({
      builtAt: Date.now() + 5,
      tx: { ...plan().tx!, data: "0xfeed01", gasLimit: "390000" },
    });
    fetchSellPlan.mockResolvedValueOnce(plan({ tokensIn: "1" })); // opening check
    fetchSellPlan.mockResolvedValueOnce(first);
    const h = mount();
    await openAndType(h);
    expect(h.flow().phase.name).toBe("form");
    fetchSellPlan.mockResolvedValueOnce(fresh);
    await act(async () => void (await h.flow().confirm()));
    await flush();
    expect(wallet.sendTx).toHaveBeenCalledTimes(1);
    const tx = wallet.sendTx.mock.calls[0]![0] as Record<string, unknown>;
    expect(tx.to).toBe(ROUTER);
    expect(tx.data).toBe("0xfeed01"); // the fresh plan's calldata, not the one on screen
    expect(tx.gas).toBe(390000n); // the plan's gas limit, exactly
    expect(tx.value).toBeUndefined(); // zero value
    expect(h.flow().phase.name).toBe("confirmed");
    // Only the transaction-status route is read: no receipts, no buy route.
    expect(fetchedUrls.every((u) => u.startsWith("/api/trade/tx-status?hash="))).toBe(true);
    h.unmount();
  });

  it("saves the hash before it starts watching, and clears it once mined", async () => {
    fetchSellPlan.mockResolvedValue(plan());
    let seen: string | null = null;
    wallet.sendTx.mockImplementation(async () => HASH);
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      seen ??= storage.get("tally.pendingSell") ?? null;
      return { ok: true, json: async () => ({ status: "success", hash: HASH, bscscan: "x" }) };
    });
    const h = mount();
    await openAndType(h);
    await act(async () => void (await h.flow().confirm()));
    await flush();
    expect(JSON.parse(seen ?? "null").hash).toBe(HASH);
    expect(storage.get("tally.pendingSell")).toBeUndefined();
    h.unmount();
  });

  it("a fresh plan with a worse minimum shows the new numbers and signs nothing", async () => {
    fetchSellPlan.mockResolvedValueOnce(plan());
    fetchSellPlan.mockResolvedValueOnce(plan());
    const h = mount();
    await openAndType(h);
    fetchSellPlan.mockResolvedValueOnce(plan({ minUsdtOut: "2300000000000000000" }));
    await act(async () => void (await h.flow().confirm()));
    await flush();
    expect(wallet.sendTx).not.toHaveBeenCalled();
    const p = h.flow().phase;
    expect(p.name).toBe("form");
    if (p.name === "form") {
      expect(p.plan?.minUsdtOut).toBe("2300000000000000000");
      expect(p.notice).toMatch(/quote changed/i);
    }
    h.unmount();
  });

  it("the user rejecting the signature spends nothing and says so", async () => {
    fetchSellPlan.mockResolvedValue(plan());
    wallet.sendTx.mockRejectedValue(
      Object.assign(new Error("User rejected the request"), { code: 4001 }),
    );
    const h = mount();
    await openAndType(h);
    await act(async () => void (await h.flow().confirm()));
    await flush();
    const p = h.flow().phase;
    expect(p.name).toBe("form");
    if (p.name === "form")
      expect(p.failure?.message).toBe("You cancelled in your wallet. Nothing was sold.");
    expect(storage.get("tally.pendingSell")).toBeUndefined();
    h.unmount();
  });

  it("needs_approval sends the plan's approval for the exact amount, waits for it, then asks for a new plan", async () => {
    const approvePlan = plan({
      status: "needs_approval",
      tx: undefined,
      simulation: undefined,
      approve: {
        to: STOCK,
        spender: ROUTER,
        data: "0x095ea7b3deadbeef",
        amount: "10000000000000000",
      },
    });
    fetchSellPlan.mockResolvedValueOnce(plan());
    fetchSellPlan.mockResolvedValueOnce(approvePlan);
    const h = mount();
    await openAndType(h);
    expect((h.flow().phase as { plan: SellPlan }).plan.status).toBe("needs_approval");
    fetchSellPlan.mockResolvedValueOnce(plan());
    await act(async () => void (await h.flow().approve()));
    await flush();
    const tx = wallet.sendTx.mock.calls[0]![0] as Record<string, unknown>;
    expect(tx.to).toBe(STOCK);
    expect(tx.data).toBe("0x095ea7b3deadbeef");
    expect(tx.gas).toBe(80000n);
    const p = h.flow().phase;
    expect(p.name).toBe("form");
    if (p.name === "form") expect(p.plan?.status).toBe("ready"); // a new plan was requested after it mined
    h.unmount();
  });

  it("never sends an approval whose amount is not exactly the amount being sold", async () => {
    const odd = plan({
      status: "needs_approval",
      tx: undefined,
      approve: {
        to: STOCK,
        spender: ROUTER,
        data: "0x095ea7b3",
        amount: "115792089237316195423570985008687907853269984665640564039457584007913129639935",
      },
    });
    fetchSellPlan.mockResolvedValueOnce(plan());
    fetchSellPlan.mockResolvedValueOnce(odd);
    const h = mount();
    await openAndType(h);
    await act(async () => void (await h.flow().approve()));
    expect(wallet.sendTx).not.toHaveBeenCalled();
    h.unmount();
  });

  it("a reverted sale ends in a plain failure with the hash, and says the tokens stayed put", async () => {
    stubStatus("reverted");
    fetchSellPlan.mockResolvedValue(plan());
    const h = mount();
    await openAndType(h);
    await act(async () => void (await h.flow().confirm()));
    await flush();
    const p = h.flow().phase;
    expect(p.name).toBe("failed");
    if (p.name === "failed") {
      expect(p.hash).toBe(HASH);
      expect(p.failure.message).toMatch(/tokens stayed put/);
    }
    h.unmount();
  });

  describe("minimum sale", () => {
    const small: SellTarget = { ...target, probeShares: 0.02, probeUsd: 4.7 };
    it("a holding or amount worth under $5 asks the server for nothing and flags it", async () => {
      const h = mount();
      await act(async () => void (await h.flow().open(small)));
      fetchSellPlan.mockClear();
      await act(async () => h.flow().setInputs({ text: "0.01" })); // about $2.35
      await flush();
      expect(h.flow().belowMinimum).toBe(true);
      expect(fetchSellPlan).not.toHaveBeenCalled();
      const p = h.flow().phase;
      expect(p.name === "form" && p.plan === null).toBe(true);
      h.unmount();
    });

    it("sliding back above the minimum clears the flag and asks for a plan", async () => {
      const big: SellTarget = { ...target, probeShares: 0.02, probeUsd: 10 };
      fetchSellPlan.mockResolvedValue(plan());
      const h = mount();
      await act(async () => void (await h.flow().open(big)));
      await act(async () => h.flow().setInputs({ text: "0.005" })); // $2.5
      await flush();
      expect(h.flow().belowMinimum).toBe(true);
      fetchSellPlan.mockClear();
      await act(async () => h.flow().setInputs({ text: "0.015" })); // $7.5
      await flush();
      expect(h.flow().belowMinimum).toBe(false);
      expect(fetchSellPlan).toHaveBeenCalled();
      h.unmount();
    });

    it("an engine refusal below the minimum drops the old plan, so no Confirm is left on screen", async () => {
      fetchSellPlan.mockResolvedValueOnce(plan({ tokensIn: "1" })); // opening check
      fetchSellPlan.mockResolvedValueOnce(plan());
      const h = mount();
      await openAndType(h);
      expect((h.flow().phase as { plan: SellPlan | null }).plan).not.toBeNull();
      fetchSellPlan.mockRejectedValueOnce(
        Object.assign(new Error("Minimum order"), { kind: "below_minimum" }),
      );
      await act(async () => h.flow().setInputs({ text: "0.001" }));
      await flush();
      const p = h.flow().phase;
      expect(p.name).toBe("form");
      if (p.name === "form") {
        expect(p.plan).toBeNull();
        expect(p.failure?.message).toBe(
          "The sale is below the $5 minimum order. Transaction will fail.",
        );
      }
      h.unmount();
    });
  });

  describe("receipt hint", () => {
    it("posts exactly one hint for the sale (kind sell, its hash, the intent id, the user) and none for the approval", async () => {
      const approvePlan = plan({
        status: "needs_approval",
        tx: undefined,
        simulation: undefined,
        approve: {
          to: STOCK,
          spender: ROUTER,
          data: "0x095ea7b3deadbeef",
          amount: "10000000000000000",
        },
      });
      fetchSellPlan.mockResolvedValueOnce(plan());
      fetchSellPlan.mockResolvedValueOnce(approvePlan);
      const h = mount();
      await openAndType(h);
      fetchSellPlan.mockResolvedValueOnce(plan());
      await act(async () => void (await h.flow().approve()));
      await flush();
      expect(hints).toHaveLength(0); // the approval never posts
      fetchSellPlan.mockResolvedValueOnce(plan());
      await act(async () => void (await h.flow().confirm()));
      await flush();
      expect(hints).toHaveLength(1);
      const hint = hints[0]!;
      expect(hint).toMatchObject({
        kind: "sell",
        txHash: HASH,
        user: wallet.address,
        ticker: "NVDA",
        isResumed: false,
      });
      expect(typeof hint.intentId).toBe("string");
      h.unmount();
    });

    it("saves the hash before the hint is posted", async () => {
      fetchSellPlan.mockResolvedValue(plan());
      let saved: string | null = null;
      const h = mount();
      await openAndType(h);
      const orig = globalThis.fetch as unknown as (u: string, i?: unknown) => Promise<unknown>;
      globalThis.fetch = vi.fn().mockImplementation(async (u: string, i?: unknown) => {
        if (u === "/api/receipts") saved ??= storage.get("tally.pendingSell") ?? null;
        return orig(u, i);
      });
      await act(async () => void (await h.flow().confirm()));
      await flush();
      expect(JSON.parse(saved ?? "null").hash).toBe(HASH);
      h.unmount();
    });

    it.each(["404", "throw"] as const)(
      "a %s from /api/receipts does not change the outcome",
      async (reply) => {
        receiptsReply = reply;
        fetchSellPlan.mockResolvedValue(plan());
        const h = mount();
        await openAndType(h);
        await act(async () => void (await h.flow().confirm()));
        await flush();
        expect(hints).toHaveLength(1);
        expect(h.flow().phase.name).toBe("confirmed");
        h.unmount();
      },
    );

    it("a sale resumed from tally.pendingSell posts once with isResumed true", async () => {
      stubStatus("pending");
      storage.set(
        "tally.pendingSell",
        JSON.stringify({
          hash: HASH,
          ticker: "NVDA",
          symbol: "NVDAB",
          at: Date.now(),
          intent: {
            id: "intent-1",
            issuer: "bstock",
            stock: STOCK,
            user: wallet.address,
            tokensIn: "10000000000000000",
            minUsdtOut: "2316600000000000000",
            tolerancePct: 1,
          },
        }),
      );
      const h = mount();
      await flush();
      expect(hints).toHaveLength(1);
      expect(hints[0]).toMatchObject({
        kind: "sell",
        txHash: HASH,
        intentId: "intent-1",
        isResumed: true,
      });
      h.unmount();
    });

    it("a resumed sale saved by an older build (no intent) posts nothing and still resumes", async () => {
      stubStatus("success");
      storage.set(
        "tally.pendingSell",
        JSON.stringify({
          hash: HASH,
          ticker: "NVDA",
          symbol: "NVDAB",
          at: Date.now(),
          wallet: wallet.address,
        }),
      );
      const h = mount();
      await flush();
      expect(hints).toHaveLength(0);
      expect(h.flow().phase.name).toBe("confirmed");
      h.unmount();
    });

    it("a pending sale for a different wallet is ignored and deleted from storage", async () => {
      stubStatus("pending");
      const differentWallet = "0x9999999999999999999999999999999999999999";
      storage.set(
        "tally.pendingSell",
        JSON.stringify({
          hash: HASH,
          ticker: "NVDA",
          symbol: "NVDAB",
          at: Date.now(),
          wallet: differentWallet,
        }),
      );
      const h = mount();
      await flush();
      expect(hints).toHaveLength(0);
      expect(h.flow().phase.name).toBe("idle");
      // Pending sell for different wallet was wiped out
      expect(storage.get("tally.pendingSell")).toBeUndefined();
      h.unmount();
    });

    it("a pending sale when unauthenticated is ignored and deleted from storage", async () => {
      stubStatus("pending");
      const oldAuthenticated = wallet.authenticated;
      wallet.authenticated = false;
      storage.set(
        "tally.pendingSell",
        JSON.stringify({
          hash: HASH,
          ticker: "NVDA",
          symbol: "NVDAB",
          at: Date.now(),
          wallet: wallet.address,
        }),
      );
      const h = mount();
      await flush();
      expect(hints).toHaveLength(0);
      expect(h.flow().phase.name).toBe("idle");
      expect(storage.get("tally.pendingSell")).toBeUndefined();
      wallet.authenticated = oldAuthenticated;
      h.unmount();
    });
  });
});
