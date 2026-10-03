import abi from "./abi.json";
import type { ChainLog, GuardedEvent, Hex, TransferEvent } from "./types";
import type { Address } from "@tally/core";

export const GUARDED_TOPIC = abi.selectors.Guarded as Hex;
export const TRANSFER_TOPIC = abi.selectors.Transfer as Hex;
export type Decoded<T> = { ok: true; value: T } | { ok: false; reason: string };
function body(hex: string): string {
  if (!/^0x(?:[\da-f]{2})*$/i.test(hex)) throw new Error("Malformed hex evidence");
  return hex.slice(2);
}
function word(data: string, index: number): string {
  const value = data.slice(index * 64, (index + 1) * 64);
  if (value.length !== 64) throw new Error("Truncated ABI word");
  return value;
}
function uint(data: string, index: number): bigint {
  return BigInt(`0x${word(data, index)}`);
}
function address(data: string, index = 0): Address {
  const value = word(data, index);
  if (!/^0{24}/.test(value)) throw new Error("Noncanonical ABI address");
  return `0x${value.slice(24).toLowerCase()}`;
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Narrow, strict decoders use the checked-in ABI; no I/O or new dependency. */
export function decodeGuarded(log: Pick<ChainLog, "topics" | "data">): Decoded<GuardedEvent> {
  try {
    if (
      log.topics.length !== 4 ||
      log.topics.some((topic) => body(topic).length !== 64) ||
      log.topics[0]?.toLowerCase() !== GUARDED_TOPIC
    )
      throw new Error("Not a Guarded event");
    const data = body(log.data);
    if (data.length !== 6 * 64) throw new Error("Invalid Guarded data length");
    return {
      ok: true,
      value: {
        user: address(body(log.topics[1]!)),
        recipient: address(body(log.topics[2]!)),
        stock: address(body(log.topics[3]!)),
        tokenIn: address(data, 0),
        amountIn: uint(data, 1),
        tokensOut: uint(data, 2),
        shares: uint(data, 3),
        multiplier: uint(data, 4),
        router: address(data, 5),
      },
    };
  } catch (error) {
    return { ok: false, reason: message(error) };
  }
}
export function decodeTransfer(log: Pick<ChainLog, "topics" | "data">): Decoded<TransferEvent> {
  try {
    if (
      log.topics.length !== 3 ||
      log.topics.some((topic) => body(topic).length !== 64) ||
      log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC
    )
      throw new Error("Not an ERC-20 Transfer event");
    const data = body(log.data);
    if (data.length !== 64) throw new Error("Invalid Transfer data length");
    return {
      ok: true,
      value: {
        from: address(body(log.topics[1]!)),
        to: address(body(log.topics[2]!)),
        value: uint(data, 0),
      },
    };
  } catch (error) {
    return { ok: false, reason: message(error) };
  }
}
export interface RevertReason {
  name: string;
  args: Record<string, bigint | Address | Hex | string>;
  data: Hex;
  reason: string;
  inner?: RevertReason;
}
function dynamic(data: string, index: number, headWords: number): Hex {
  const offset = uint(data, index);
  if (
    offset % 32n !== 0n ||
    offset < BigInt(headWords * 32) ||
    offset > BigInt(data.length / 2 - 32)
  )
    throw new Error("Invalid dynamic ABI offset");
  const start = Number(offset) * 2;
  const length = uint(data.slice(start), 0);
  if (length > BigInt((data.length - start - 64) / 2))
    throw new Error("Truncated dynamic ABI data");
  return `0x${data.slice(start + 64, start + 64 + Number(length) * 2)}`;
}
/** Unknown or malformed reverts carry a reason rather than guessed diagnoses. */
export function decodeRevert(data: Hex, depth = 0): RevertReason {
  try {
    const encoded = body(data);
    const selector = `0x${encoded.slice(0, 8)}`.toLowerCase();
    const entry = abi.abi.find(
      (item) =>
        item.type === "error" &&
        abi.selectors[item.name as keyof typeof abi.selectors] === selector,
    );
    if (!entry) throw new Error("Unknown revert selector");
    const payload = encoded.slice(8);
    if (payload.length < entry.inputs.length * 64) throw new Error("Truncated revert arguments");
    if (
      !entry.inputs.some((input) => ["bytes", "string"].includes(input.type)) &&
      payload.length !== entry.inputs.length * 64
    )
      throw new Error("Invalid revert data length");
    const args: RevertReason["args"] = {};
    for (const [index, input] of entry.inputs.entries()) {
      if (input.type === "address") args[input.name] = address(payload, index);
      else if (input.type === "bytes32") args[input.name] = `0x${word(payload, index)}`;
      else if (input.type === "bytes" || input.type === "string") {
        const value = dynamic(payload, index, entry.inputs.length);
        args[input.name] =
          input.type === "string"
            ? decodeURIComponent(value.slice(2).replace(/../g, "%$&"))
            : value;
      } else {
        const value = uint(payload, index);
        const bits = Number(input.type.slice(4));
        if (!bits || value >= 2n ** BigInt(bits)) throw new Error("Invalid ABI integer");
        args[input.name] = value;
      }
    }
    const inner =
      entry.name === "RouterCallFailed" && depth < 4
        ? decodeRevert(args.reason as Hex, depth + 1)
        : undefined;
    return {
      name: entry.name,
      args,
      data,
      reason: inner
        ? `${entry.name}: ${inner.reason}`
        : `${entry.name}(${Object.values(args).join(", ")})`,
      ...(inner ? { inner } : {}),
    };
  } catch (error) {
    return { name: "Unknown", args: {}, data, reason: message(error) };
  }
}
