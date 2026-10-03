import cases from "./edge-cases.json";
import abi from "../abi.json";
import { recordedReceipt, type VectorName } from "./recorded";
import { GUARDED_TOPIC, TRANSFER_TOPIC } from "../decode";
import { receiptShares } from "../reconcile";
import type { Address } from "@tally/core";
import type { Hex, Receipt } from "../types";

export const edgeCases = cases;
const word = (value: bigint) => value.toString(16).padStart(64, "0");
export function edgeReceipt(id: string): Receipt & { synthetic: true } {
  const fixture = cases.find((item) => item.id === id);
  if (!fixture?.synthetic) throw new Error("Synthetic fixture must be labelled");
  const receipt = {
    ...structuredClone(recordedReceipt(fixture.base as VectorName)),
    synthetic: true as const,
  };
  receipt.notes = [...receipt.notes, `synthetic: true; ${id} derived from ${fixture.base}`];
  const realized = receipt.realized!;
  const output = (log: (typeof realized.logs)[number]) =>
    log.address.toLowerCase() === receipt.intent.asset &&
    log.topics[0] === TRANSFER_TOPIC &&
    log.topics[2]?.slice(-40) === receipt.intent.recipient.slice(2);
  switch (fixture.change) {
    case "decimals":
      receipt.intent.tokenDecimals = Number(fixture.value);
      break;
    case "wrongConversion":
      receipt.conversion!.multiplier = BigInt(fixture.value!);
      break;
    case "spoofedGuard":
      realized.logs = realized.logs.map((log) =>
        log.topics[0] === GUARDED_TOPIC ? { ...log, address: fixture.value as Address } : log,
      );
      break;
    case "asset":
      receipt.intent.asset = fixture.value as Address;
      receipt.quote!.expectedOut.asset = fixture.value as Address;
      break;
    case "removeTransfers":
      realized.logs = realized.logs.filter((log) => !output(log));
      break;
    case "incrementTransfer":
      realized.logs = realized.logs.map((log) =>
        output(log) ? { ...log, data: `0x${word(BigInt(log.data) + 1n)}` } : log,
      );
      break;
    case "otherTx":
      realized.logs = realized.logs.map((log) => ({
        ...log,
        transactionHash: `0x${"0".repeat(64)}` as Hex,
      }));
      break;
    case "duplicateLog":
      realized.logs = [...realized.logs, realized.logs[0]!];
      break;
    case "removedLog":
      realized.logs = realized.logs.map((log) => ({ ...log, removed: true }));
      break;
    case "removeGuard":
      realized.logs = realized.logs.filter((log) => log.topics[0] !== GUARDED_TOPIC);
      break;
    case "raiseMinimum":
      receipt.intent.minShares =
        receiptShares(BigInt(realized.logs.find(output)!.data), receipt.conversion!) + 1n;
      break;
    case "pending":
      receipt.realized = null;
      break;
    case "noRevertBytes":
      realized.revertData = null;
      realized.failureReason = null;
      break;
    case "quote":
      receipt.quote!.expectedOut.raw = BigInt(fixture.value!);
      break;
    case "threshold": {
      const tokens = BigInt(fixture.receivedTokens!);
      const shares = receiptShares(tokens, receipt.conversion!);
      receipt.quote!.expectedOut.raw = BigInt(fixture.expectedTokens!);
      receipt.intent.minShares =
        (receiptShares(BigInt(fixture.expectedTokens!), receipt.conversion!) * 99n) / 100n;
      realized.logs = realized.logs.map((log) => {
        if (output(log)) return { ...log, data: `0x${word(tokens)}` };
        if (log.topics[0] === GUARDED_TOPIC)
          return {
            ...log,
            data: `0x${log.data.slice(2, 2 + 2 * 64)}${word(tokens)}${word(shares)}${log.data.slice(2 + 4 * 64)}`,
          };
        return log;
      });
      break;
    }
    case "refund": {
      const original = realized.logs.find(
        (log) =>
          log.address === receipt.intent.spend.asset &&
          log.topics[0] === TRANSFER_TOPIC &&
          log.topics[1]?.slice(-40) === receipt.intent.user.slice(2),
      )!;
      realized.logs = [
        ...realized.logs,
        {
          ...original,
          topics: [TRANSFER_TOPIC, original.topics[2]!, original.topics[1]!],
          data: `0x${word(BigInt(fixture.value!))}`,
          logIndex: Math.max(...realized.logs.map((log) => log.logIndex)) + 1,
        },
      ];
      break;
    }
    case "revert": {
      const selector = abi.selectors[fixture.name as keyof typeof abi.selectors];
      const args = fixture
        .args!.split(",")
        .map((value) => word(BigInt(value)))
        .join("");
      realized.status = "reverted";
      realized.logs = [];
      realized.revertData = `${selector}${args}` as Hex;
      break;
    }
    case "nestedRevert":
      realized.status = "reverted";
      realized.logs = [];
      realized.revertData =
        `${abi.selectors.RouterCallFailed}${word(32n)}${word(4n)}${fixture.inner!.slice(2).padEnd(64, "0")}` as Hex;
      break;
    case "truncatedEvent":
      realized.logs = realized.logs.map((log) =>
        log.topics[0] === GUARDED_TOPIC ? { ...log, data: "0x" } : log,
      );
      break;
    case "laterMultiplier":
    case "wrongSimulationGas":
    case "reference":
    case "fiveFills":
      break;
    default:
      throw new Error(`Unknown synthetic edge: ${fixture.change}`);
  }
  return receipt;
}
