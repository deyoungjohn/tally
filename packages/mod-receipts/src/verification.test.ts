import { expect, it } from "vitest";
import recorded from "../../../spike/results/receipt_vectors_20261003T170030619036Z.json";
import edges from "./fixtures/ingestion-edges.synthetic.json";
import { recordedHint } from "./fixtures/ingestion";
import { recordedReceipt } from "./fixtures/recorded";
import {
  verifySignedCall,
  promoteReceipt,
  type TransactionEvidence,
  type MinedEvidence,
} from "./verification";
import type { Hex } from "./types";
import type { RegistryToken } from "@tally/core";
const h = recordedHint();
const guard = "0x28f6f19bffbf25e36452c78d12090f0bc922970a";
const usdt = "0x55d398326f99059ff775485246999027b3197955";
function transaction(name: "F11_NVDAB" | "F11_NVDAon"): TransactionEvidence {
  const t = recorded.vectors[name].transaction.result;
  return {
    hash: t.hash as Hex,
    sender: t.from as Hex,
    destination: t.to as Hex,
    value: BigInt(t.value),
    input: t.input as Hex,
    inputSelector: t.input.slice(0, 10) as Hex,
    gasLimit: BigInt(t.gas),
    blockNumber: BigInt(t.blockNumber),
  };
}
function mined(name: "F11_NVDAB" | "F11_NVDAon"): MinedEvidence {
  const r = recordedReceipt(name).realized!,
    t = transaction(name);
  return {
    hash: r.txHash,
    sender: t.sender,
    destination: t.destination,
    blockNumber: r.block!,
    gasUsed: r.gasUsed!,
    status: "success",
    logs: r.logs,
  };
}
it.each(["F11_NVDAB", "F11_NVDAon"] as const)(
  "decodes signed minimum and proves the real %s chain fill",
  (name) => {
    const hint = recordedHint(name),
      tx = transaction(name),
      call = verifySignedCall(tx, hint, guard);
    expect(call).toMatchObject({
      kind: "swap",
      minShares: BigInt(hint.quote!.minShares),
      stock: hint.quote!.stock,
    });
    const token: RegistryToken = {
      ticker: "NVDA",
      issuer: hint.quote!.issuer,
      address: hint.quote!.stock,
      symbol: "NVDA",
      decimals: 18,
      assetType: 1,
      multiplierSource: hint.quote!.issuer === "ondo" ? "api" : "onchain-uiMultiplier",
      executable: true,
    };
    const promoted = promoteReceipt(hint, tx, mined(name), call, token, 0);
    expect(promoted.result!.status).toBe("RECONCILED");
    expect(promoted.verifiedFill!.shares).toBe(
      recordedReceipt(name).realized ? promoted.result!.sharesReceived : null,
    );
  },
);
it("synthetic USDT approval is accepted only for ShareGuard with a nonzero, non-unlimited amount", () => {
  const base = transaction("F11_NVDAB");
  const input =
    `${edges.approvalSelector}${guard.slice(2).padStart(64, "0")}${"1".padStart(64, "0")}` as Hex;
  const approval = {
    ...base,
    synthetic: edges.synthetic,
    destination: usdt,
    input,
    inputSelector: edges.approvalSelector as Hex,
  } as const;
  expect(verifySignedCall(approval, h, guard)).toEqual({ kind: "approval", amount: 1n });
  expect(() =>
    verifySignedCall(
      { ...approval, input: (input.slice(0, -64) + "f".repeat(64)) as Hex },
      h,
      guard,
    ),
  ).toThrow("Only a USDT approval");
  expect(() =>
    verifySignedCall(
      { ...approval, input: input.replace(guard.slice(2), edges.wrongDestination.slice(2)) as Hex },
      h,
      guard,
    ),
  ).toThrow("Only a USDT approval");
  expect(() => verifySignedCall({ ...approval, inputSelector: "0xdeadbeef" }, h, guard)).toThrow(
    "selector mismatch",
  );
});
it("rejects malformed guard calldata, foreign destinations, mismatched assets and malformed receipt identity", () => {
  const tx = transaction("F11_NVDAB");
  const foreign = { ...tx, synthetic: true, destination: edges.wrongDestination as Hex };
  expect(() => verifySignedCall(foreign, h, guard)).toThrow("not a ShareGuard");
  expect(() => verifySignedCall({ ...tx, input: tx.input.slice(0, -2) as Hex }, h, guard)).toThrow(
    "calldata",
  );
  expect(() =>
    verifySignedCall(
      tx,
      { ...h, quote: { ...h.quote!, stock: edges.wrongDestination as Hex } },
      guard,
    ),
  ).toThrow("signed assets");
  expect(() =>
    promoteReceipt(
      h,
      tx,
      { ...mined("F11_NVDAB"), hash: edges.missingHash as Hex },
      verifySignedCall(tx, h, guard),
      null,
      0,
    ),
  ).toThrow("receipt mismatch");
});
