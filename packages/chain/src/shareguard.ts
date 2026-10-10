import {
  decodeErrorResult,
  encodeFunctionData,
  getAddress,
  parseAbi,
  parseEventLogs,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { BSC_CHAIN_ID, USDT_BSC } from "@tally/config";
import type { Address } from "@tally/core";
import type { BscClient } from "./client";

/** The parts of ShareGuard v1 (`contracts/src/ShareGuard.sol`) that the app calls or decodes. */
export const SHAREGUARD_ABI = parseAbi([
  "function swapForShares(address tokenIn, uint256 amountIn, address stock, uint256 minShares, address router, bytes routerData, address recipient, uint256 deadline) returns (uint256 shares)",
  "function swapForSharesWithFeed(address tokenIn, uint256 amountIn, address stock, uint256 minShares, address router, bytes routerData, address recipient, uint256 deadline, (address stock, uint256 multiplier, uint64 validAfter, uint64 validUntil) u, bytes sig) returns (uint256 shares)",
  "function sharesPerToken(address stock) view returns (uint256)",
  "function isTokenPaused(address stock) view returns (bool)",
  "function paused() view returns (bool)",
  "function allowedRouter(address router) view returns (bool)",
  "function approveTargetOf(address router) view returns (address)",
  "function assetOf(address stock) view returns ((uint8 source, bool enabled, uint16 maxStepBps, uint8 pauseCheck, address pauseManager))",
  "function feedOf(address stock) view returns (uint256 multiplier, uint64 updatedAt, uint64 validAfter)",
  "function maxAge() view returns (uint64)",
  "event Guarded(address indexed user, address indexed recipient, address indexed stock, address tokenIn, uint256 amountIn, uint256 tokensOut, uint256 shares, uint256 multiplier, address router)",
  "error Expired(uint256 deadline)",
  "error ZeroAmount()",
  "error ZeroMinShares()",
  "error SameToken()",
  "error RouterNotAllowed(address router)",
  "error InvalidRouterConfig(address router)",
  "error AssetNotEnabled(address stock)",
  "error TokenPaused(address stock)",
  "error PauseCheckFailed(address stock)",
  "error MultiplierUnavailable(address stock)",
  "error NoOutput()",
  "error InsufficientShares(uint256 shares, uint256 minShares)",
  "error RouterCallFailed(bytes reason)",
  "error NotAFeedAsset(address stock)",
  "error FeedStale(address stock, uint64 updatedAt, uint64 maxAge)",
  "error FeedNotSeeded(address stock)",
  "error InvalidSigner()",
  "error UpdateNotValidNow(uint64 validAfter, uint64 validUntil)",
  "error UpdateOlderThanStored(uint64 validAfter, uint64 storedValidAfter)",
  "error UpdateConflictsWithStored(uint64 validAfter)",
  "error UpdateOutOfBounds(address stock, uint256 current, uint256 proposed)",
  "error EnforcedPause()",
]);

export const ERC20_ABI = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

export interface FeedUpdate {
  stock: Address;
  /** Shares per token, 1e18 fixed point. */
  multiplier: bigint;
  validAfter: bigint;
  validUntil: bigint;
}

/** EIP-712 typed data the feed signer signs; domain as in `ShareGuard`'s constructor (name "ShareGuard", version "1"). */
export function feedUpdateTypedData(guard: Address, update: FeedUpdate) {
  return {
    domain: {
      name: "ShareGuard",
      version: "1",
      chainId: BSC_CHAIN_ID,
      verifyingContract: guard,
    },
    types: {
      FeedUpdate: [
        { name: "stock", type: "address" },
        { name: "multiplier", type: "uint256" },
        { name: "validAfter", type: "uint64" },
        { name: "validUntil", type: "uint64" },
      ],
    },
    primaryType: "FeedUpdate",
    message: update,
  } as const;
}

export interface SwapCallInput {
  amountIn: bigint;
  stock: Address;
  minShares: bigint;
  router: Address;
  routerData: Hex;
  recipient: Address;
  deadline: bigint;
  feed?: { update: FeedUpdate; signature: Hex };
}

/** Calldata for `swapForShares` (bStock, or Ondo with a fresh stored value) or `swapForSharesWithFeed` (Ondo with a signed update). tokenIn is always USDT. */
export function encodeSwapCall(i: SwapCallInput): Hex {
  const common = [
    USDT_BSC,
    i.amountIn,
    i.stock,
    i.minShares,
    i.router,
    i.routerData,
    i.recipient,
    i.deadline,
  ] as const;
  if (i.feed) {
    return encodeFunctionData({
      abi: SHAREGUARD_ABI,
      functionName: "swapForSharesWithFeed",
      args: [...common, i.feed.update, i.feed.signature],
    });
  }
  return encodeFunctionData({ abi: SHAREGUARD_ABI, functionName: "swapForShares", args: common });
}

export function encodeApprove(spender: Address, amount: bigint): Hex {
  return encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [spender, amount] });
}

export interface GuardRevert {
  name: string;
  args: readonly unknown[];
}

/** Decode a ShareGuard custom error from revert data. Undefined when the data is not one of ours (e.g. a plain out-of-gas). */
export function decodeGuardRevert(data: Hex | undefined): GuardRevert | undefined {
  if (!data || data === "0x") return undefined;
  try {
    const d = decodeErrorResult({ abi: SHAREGUARD_ABI, data });
    return { name: d.errorName, args: d.args ?? [] };
  } catch {
    return undefined;
  }
}

export interface GuardedFill {
  user: Address;
  recipient: Address;
  stock: Address;
  tokenIn: Address;
  amountIn: bigint;
  tokensOut: bigint;
  /** Shares received, 1e18 fixed point (the number the guarantee is about). */
  shares: bigint;
  multiplier: bigint;
  router: Address;
}

/** The `Guarded` event of this guard in a receipt. Only logs emitted by `guard` count. */
export function decodeGuarded(
  receipt: Pick<TransactionReceipt, "logs">,
  guard: Address,
): GuardedFill | undefined {
  const logs = parseEventLogs({ abi: SHAREGUARD_ABI, eventName: "Guarded", logs: receipt.logs });
  const ev = logs.find((l) => l.address.toLowerCase() === guard.toLowerCase());
  if (!ev) return undefined;
  const a = ev.args;
  return {
    user: getAddress(a.user) as Address,
    recipient: getAddress(a.recipient) as Address,
    stock: getAddress(a.stock) as Address,
    tokenIn: getAddress(a.tokenIn) as Address,
    amountIn: a.amountIn,
    tokensOut: a.tokensOut,
    shares: a.shares,
    multiplier: a.multiplier,
    router: getAddress(a.router) as Address,
  };
}

/** ShareGuard's `Source` enum, in contract order (contracts/src/ShareGuard.sol). Ondo is Feed (3); 2 is xStocks, which Tally never routes. */
export const GUARD_SOURCE = { None: 0, UiMultiplier: 1, Multiplier: 2, Feed: 3 } as const;

export interface GuardReading {
  paused: boolean;
  enabled: boolean;
  /** Per-token pause check; `undefined` when the check itself reverted (fails closed onchain). */
  tokenPaused?: boolean;
  /** Shares per token the guard would use now. Undefined when it reverts (a stale Ondo feed), with the reason. */
  sharesPerToken?: bigint;
  sharesPerTokenError?: string;
  /** 0 = UiMultiplier, 1 = Multiplier, 2 = Feed (the enum order in the contract). */
  source: number;
  routerAllowed: boolean;
  approveTarget: Address;
  feed: { multiplier: bigint; updatedAt: bigint; validAfter: bigint };
  maxAge: bigint;
}

const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as const;

/** Reads what the trade plan needs from the deployed guard in one multicall-sized batch. */
export async function readGuard(
  client: BscClient,
  guard: Address,
  stock: Address,
  router: Address,
): Promise<GuardReading> {
  const read = <
    F extends "paused" | "allowedRouter" | "approveTargetOf" | "assetOf" | "feedOf" | "maxAge",
  >(
    functionName: F,
    args?: readonly unknown[],
  ) =>
    client.readContract({
      address: guard,
      abi: SHAREGUARD_ABI,
      functionName,
      args: args as never,
    } as never) as Promise<never>;
  const [paused, routerAllowed, approveTarget, asset, feed, maxAge] = (await Promise.all([
    read("paused"),
    read("allowedRouter", [router]),
    read("approveTargetOf", [router]),
    read("assetOf", [stock]),
    read("feedOf", [stock]),
    read("maxAge"),
  ])) as unknown as [
    boolean,
    boolean,
    Address,
    { source: number; enabled: boolean },
    readonly [bigint, bigint, bigint],
    bigint,
  ];
  // A revert is an answer (a stale Ondo feed, a failed pause check) and is reported as it is. Anything else (a timeout, a rate
  // limit or a 403 from the RPC) is a failure to ask, so ask again a couple of times before giving up: one flaky RPC call used to
  // surface as "The share count for this token can't be read right now".
  const settle = async <T>(call: () => Promise<T>): Promise<{ v?: T; err?: string }> => {
    for (let attempt = 0; ; attempt++) {
      try {
        return { v: await call() };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (attempt >= 2 || /revert/i.test(msg)) return { err: msg.split("\n")[0] };
        await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
      }
    }
  };
  const [spt, tp] = await Promise.all([
    settle(() =>
      client.readContract({
        address: guard,
        abi: SHAREGUARD_ABI,
        functionName: "sharesPerToken",
        args: [stock],
      }),
    ),
    settle(() =>
      client.readContract({
        address: guard,
        abi: SHAREGUARD_ABI,
        functionName: "isTokenPaused",
        args: [stock],
      }),
    ),
  ]);
  return {
    paused,
    enabled: asset.enabled,
    source: Number(asset.source),
    tokenPaused: tp.v,
    sharesPerToken: spt.v,
    sharesPerTokenError: spt.err,
    routerAllowed,
    approveTarget:
      approveTarget === ZERO_ADDR ? ZERO_ADDR : (approveTarget.toLowerCase() as Address),
    feed: { multiplier: feed[0], updatedAt: feed[1], validAfter: feed[2] },
    maxAge,
  };
}
