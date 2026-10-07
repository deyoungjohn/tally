import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { openStore, type OpenSnapshotStore } from "@tally/modkit";
import { E18 } from "@tally/core";
import { readDecisionLog, type PolicySettings } from "@tally/mod-autopilot";
import { clearUserRateLimits } from "../../../../../lib/server/session";
import { job } from "../../../../../../worker/src/jobs/autopilot";
import {
  collectorContext,
  registryRow,
  seedRegistry,
} from "../../../../../../../packages/mod-autopilot/src/collector-fixtures";
import {
  constructedAlert,
  CONSTRUCTED_WALLET as wallet,
  CONSTRUCTED_TOKEN as token,
  CONSTRUCTED_NOW as now,
} from "../../../../../../../packages/mod-autopilot/src/fixtures";
import { GET, PUT } from "./route";

vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ store: undefined as unknown, authenticated: true, flag: true }));
vi.mock("@tally/modkit", async (original) => ({
  ...(await original<typeof import("@tally/modkit")>()),
  openStore: (path?: string) => (path ? openReal(path) : state.store),
}));
// Capture the real store factory separately so no route can open a disk/live store.
const openReal = (await vi.importActual<typeof import("@tally/modkit")>("@tally/modkit")).openStore;
vi.mock("../../../../../lib/flags", () => ({ moduleFlags: () => ({ autopilot: state.flag }) }));
vi.mock("../../../../../lib/server/session", async (original) => ({
  ...(await original<typeof import("../../../../../lib/server/session")>()),
  verifiedWallet: vi.fn(async (_req: Request, chosen?: string | null) =>
    state.authenticated &&
    (!chosen || chosen.toLowerCase() === "0x0000000000000000000000000000000000000001")
      ? "0x0000000000000000000000000000000000000001"
      : null,
  ),
}));
let store: OpenSnapshotStore;
let close: () => void;
let ip = 0;
const victim = `0x${"9".repeat(40)}`;
const valid = {
  armedRules: { "grade-drop": { atOrBelow: "D" } },
  tokenAllowList: [token],
  perTradeCap: "25",
  dailyCap: "50",
};
function request(method: string, body?: unknown, headers: Record<string, string> = {}, query = "") {
  return new NextRequest(`http://localhost/api/session/autopilot/policy${query}`, {
    method,
    headers: { "content-type": "application/json", "cf-connecting-ip": `test-${ip}`, ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  clearUserRateLimits();
  ip++;
  state.authenticated = true;
  state.flag = true;
  store = openStore(":memory:");
  close = store.close.bind(store);
  store.close = vi.fn();
  state.store = store;
  seedRegistry(store);
});
afterEach(() => {
  close();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

it("spoof test: query/cookie/body cannot choose the wallet; unverified GET and PUT are 401", async () => {
  state.authenticated = false;
  const query = `?address=${victim}&walletAddress=${victim}`;
  expect(
    (
      await GET(
        request(
          "GET",
          undefined,
          { cookie: `walletAddress=${victim}`, "x-tally-wallet": victim },
          query,
        ),
      )
    ).status,
  ).toBe(401);
  expect(
    (
      await PUT(
        request(
          "PUT",
          { ...valid, walletAddress: victim },
          { cookie: `walletAddress=${victim}` },
          query,
        ),
      )
    ).status,
  ).toBe(401);
  expect(store.history("autopilot-policy", victim, 0)).toHaveLength(0);
  state.authenticated = true;
  const response = await PUT(request("PUT", valid, { cookie: `walletAddress=${victim}` }, query));
  expect(response.status).toBe(200);
  expect((await response.json()).walletAddress).toBe(wallet);
  expect(
    (await GET(request("GET", undefined, { cookie: `walletAddress=${victim}` }, query))).status,
  ).toBe(200);
  expect((await PUT(request("PUT", { ...valid, walletAddress: victim }))).status).toBe(400);
  expect((await GET(request("GET", undefined, { "x-tally-wallet": victim }))).status).toBe(401);
  expect(store.history("autopilot-policy", victim, 0)).toHaveLength(0);
});
it("flag off returns 404 before auth or store access", async () => {
  state.flag = false;
  expect((await GET(request("GET"))).status).toBe(404);
  expect((await PUT(request("PUT", valid))).status).toBe(404);
  expect(store.history("autopilot-policy", wallet, 0)).toHaveLength(0);
});
it.each([
  { perTradeCap: "100.000000000000000001" },
  { dailyCap: "250.000000000000000001" },
  { perTradeCap: "5.999999999999999999" },
  { dailyCap: "5" },
  { perTradeCap: 25 },
  { perTradeCap: "-6" },
  { perTradeCap: "1e2" },
  { perTradeCap: "6.0000000000000000001" },
  { killSwitch: "false" },
  { extra: true },
  { armedRules: { switch: {} } },
  { armedRules: { paused: { longerThanHours: 0 } } },
  { armedRules: { paused: { longerThanHours: 721 } } },
  { armedRules: { "grade-drop": { atOrBelow: "C" } } },
  { armedRules: { "price-threshold": { stopUsdPerShare: "0" } } },
  { armedRules: { "grade-drop": { atOrBelow: "D", extra: true } } },
  { tokenAllowList: Array(11).fill(token) },
  { tokenAllowList: [token, token.toUpperCase().replace("0X", "0x")] },
])("rejects invalid policy without writing: %j", async (invalid) => {
  const response = await PUT(request("PUT", { ...valid, ...invalid }));
  expect(response.status).toBe(400);
  expect(store.history("autopilot-policy", wallet, 0)).toHaveLength(0);
});
it.each(["unknown", "xstocks", "unknown-issuer"])(
  "rejects %s allow-list tokens with a reason",
  async (kind) => {
    if (kind !== "unknown")
      store.put({
        kind: "registry",
        key: "bsc",
        data: [{ ...registryRow, platformId: kind === "xstocks" ? "xstocks" : "unsupported" }],
        source: "constructed",
        observedAt: now,
      });
    const res = await PUT(
      request("PUT", { ...valid, tokenAllowList: [kind === "unknown" ? victim : token] }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(
      kind === "xstocks" ? /xStocks have no market/ : /Unknown token/,
    );
  },
);
it("accepts executable bStock registry entries", async () => {
  store.put({
    kind: "registry",
    key: "bsc",
    data: [{ ...registryRow, platformId: "bstock" }],
    source: "constructed",
    observedAt: now,
  });
  expect((await PUT(request("PUT", valid))).status).toBe(200);
});
it("defaults kill switch on; USD ceilings/minimum exact boundaries accepted and bigints serialized", async () => {
  const save = await PUT(
    request("PUT", {
      ...valid,
      perTradeCap: "100",
      dailyCap: "250",
      armedRules: {
        paused: { longerThanHours: 720 },
        "grade-drop": { atOrBelow: "F" },
        "price-threshold": { stopUsdPerShare: "0.000000000000000001" },
      },
    }),
  );
  expect(save.status).toBe(200);
  expect((await save.json()).policy).toMatchObject({
    killSwitch: true,
    perTradeCap: (100n * E18).toString(),
    dailyCap: (250n * E18).toString(),
  });
  const res = await GET(request("GET"));
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({
    walletAddress: wallet,
    ceilings: { perTradeCap: (100n * E18).toString(), dailyCap: (250n * E18).toString() },
    defaults: {
      perTradeCap: (25n * E18).toString(),
      dailyCap: (50n * E18).toString(),
      killSwitch: true,
    },
    viewModel: { policyEditable: true },
    collector: { state: "never collected" },
  });
  expect((await PUT(request("PUT", { ...valid, perTradeCap: "6", dailyCap: "6" }))).status).toBe(
    200,
  );
});
it("20 policy writes per hour per verified wallet; IP limits also trip", async () => {
  for (let i = 0; i < 20; i++)
    expect((await PUT(request("PUT", valid, { "cf-connecting-ip": `rotating-${i}` }))).status).toBe(
      200,
    );
  expect((await PUT(request("PUT", valid, { "cf-connecting-ip": "different-ip" }))).status).toBe(
    429,
  );
  vi.setSystemTime(now + 3_600_001);
  store.put({
    kind: "registry",
    key: "bsc",
    data: [registryRow],
    source: "constructed",
    observedAt: now + 3_600_001,
  });
  expect((await PUT(request("PUT", valid))).status).toBe(200);
  state.authenticated = false;
  for (let i = 0; i < 60; i++) expect((await GET(request("GET"))).status).toBe(401);
  expect((await GET(request("GET"))).status).toBe(429);
});
it("each save appends a policy row, newest drives a full collected shadow run and GET exposes status/log", async () => {
  expect((await PUT(request("PUT", valid))).status).toBe(200);
  expect(
    (await PUT(request("PUT", { ...valid, perTradeCap: "6", killSwitch: false }))).status,
  ).toBe(200);
  expect(store.history<PolicySettings>("autopilot-policy", wallet, 0)).toHaveLength(2);
  store.put({
    kind: "alerts",
    key: wallet,
    data: [constructedAlert()],
    source: "constructed",
    observedAt: now,
  });
  vi.stubEnv("FEATURE_AUTOPILOT", "1");
  await job.run(collectorContext(store));
  expect(readDecisionLog(store)[0]).toMatchObject({
    decision: "execute",
    mode: "shadow",
    leg: { usdCap: 6n * E18 },
    inputs: { policy: { killSwitch: false, perTradeCap: 6n * E18 } },
  });
  const response = await GET(request("GET"));
  expect(await response.json()).toMatchObject({
    positions: [
      {
        token,
        shares: (100n * E18).toString(),
        usdValue: (1000n * E18).toString(),
        ageMs: 0,
        paused: false,
      },
    ],
    collector: { state: "ok" },
    viewModel: {
      rows: [{ mode: "shadow", label: "would have sold; nothing was executed" }],
      spentToday: "0",
    },
  });
});
it("missing/stale registry fails closed; a safe empty policy can still enable the kill switch", async () => {
  vi.setSystemTime(now + 600_001);
  expect((await PUT(request("PUT", valid))).status).toBe(503);
  expect((await PUT(request("PUT", {}))).status).toBe(200);
  expect(
    store.latest<PolicySettings>("autopilot-policy", wallet, { maxAgeMs: 1e9 })?.data.killSwitch,
  ).toBe(true);
});
it("read failure warns and returns 503 without replacing saved policy", async () => {
  await PUT(request("PUT", valid));
  vi.spyOn(store, "latest").mockImplementationOnce(() => {
    throw new Error("store unavailable");
  });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  expect((await GET(request("GET"))).status).toBe(503);
  expect(warn).toHaveBeenCalled();
  expect(store.history("autopilot-policy", wallet, 0)).toHaveLength(1);
  warn.mockRestore();
});
