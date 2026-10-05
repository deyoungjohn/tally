import { expect, it, vi } from "vitest";
import { TransactionNotFoundError, TransactionReceiptNotFoundError, type PublicClient } from "viem";
import { transactionsFromClients, transactionsFromEnv } from "./transactions";
const hash = `0x${"a".repeat(64)}` as const;
const user = `0x${"1".repeat(40)}` as const;
const tx = {
  hash,
  from: user,
  to: user,
  value: 0n,
  input: "0xaabbccdd",
  blockNumber: null,
  gas: 100n,
};
function client(overrides: object): PublicClient {
  return overrides as PublicClient;
}
it("fails over with redacted warnings and preserves pending transaction fields", async () => {
  const warn = vi.fn();
  const reader = transactionsFromClients(
    [
      client({
        getTransaction: async () => {
          throw new Error("https://provider/secret-key");
        },
      }),
      client({ getTransaction: async () => tx }),
    ],
    warn,
  );
  expect(await reader.getTransaction(hash)).toMatchObject({
    sender: user,
    destination: user,
    gasLimit: 100n,
    blockNumber: null,
    inputSelector: "0xaabbccdd",
  });
  expect(warn.mock.calls.flat().join()).not.toMatch(/secret|https/);
  await expect(reader.getTransaction("bad")).rejects.toThrow("Invalid transaction hash");
});
it("missing receipt is pending, missing transactions return null, and outages throw a redacted error", async () => {
  const reader = transactionsFromClients([
    client({
      getTransaction: async () => {
        throw new TransactionNotFoundError({ hash });
      },
      getTransactionReceipt: async () => {
        throw new TransactionReceiptNotFoundError({ hash });
      },
    }),
  ]);
  expect(await reader.getTransaction(hash)).toBeNull();
  expect(await reader.getReceipt(hash)).toBeNull();
  const warn = vi.fn();
  const down = transactionsFromClients(
    [
      client({
        getTransactionReceipt: async () => {
          throw new Error("api-key");
        },
      }),
    ],
    warn,
  );
  await expect(down.getReceipt(hash)).rejects.toThrow(
    "No configured chain provider answered transaction receipt",
  );
  expect(warn.mock.calls.flat().join()).not.toContain("api-key");
});
it("returns full chain logs and gas/status; no provider warns once at construction", async () => {
  const reader = transactionsFromClients([
    client({
      getTransactionReceipt: async () => ({
        transactionHash: hash,
        from: user,
        to: user,
        blockNumber: 12n,
        gasUsed: 90n,
        status: "reverted",
        logs: [
          {
            address: user,
            topics: [hash],
            data: "0x",
            transactionHash: hash,
            blockNumber: 12n,
            logIndex: 2,
            removed: false,
          },
        ],
      }),
    }),
  ]);
  expect(await reader.getReceipt(hash)).toMatchObject({
    gasUsed: 90n,
    status: "reverted",
    logs: [{ transactionHash: hash, blockNumber: 12n, logIndex: 2 }],
  });
  const warn = vi.fn();
  const empty = transactionsFromEnv({}, warn);
  expect(warn).toHaveBeenCalledTimes(1);
  await expect(empty.getTransaction(hash)).rejects.toThrow("No configured chain provider");
  expect(warn).toHaveBeenCalledTimes(1);
});
