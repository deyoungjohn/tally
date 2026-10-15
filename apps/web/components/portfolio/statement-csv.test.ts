import { expect, it } from "vitest";
import type { StatementVM } from "@/modules/statement/view-model";
import { csvWithLines } from "./statement-csv";

const line = (hash: string): StatementVM["lines"][number] => ({
  date: "2026-10-13T10:00:00.000Z",
  ticker: "NVDA",
  issuer: "ondo",
  type: "BUY",
  amountTokens: "0.1",
  multiplier: "1",
  amountShares: "0.1",
  pricePerShareUsd: "200.00",
  valueUsd: "20.00",
  convertedAtTodaysRatio: false,
  txHash: hash,
});

const vm = (content: string) =>
  ({ walletAddress: "0xabc", csv: { filename: "x.csv", content } }) as unknown as StatementVM;

it("keeps the summary and rewrites the trades from the merged lines", () => {
  const out = csvWithLines(
    vm(
      "# Tally Portfolio Statement\r\nWallet,0xabc\r\n\r\n# Activity / Trades\r\nDate,old\r\nold row",
    ),
    [line("0x1"), line("0x2")],
  );
  expect(out).toContain("Wallet,0xabc");
  expect(out).not.toContain("old row");
  expect(out.match(/0x[12]$/gm)).toHaveLength(2);
});

it("still builds a CSV when the feed had no statement at all", () => {
  const out = csvWithLines(vm(""), [line("0x9")]);
  expect(out).toContain("# Activity / Trades");
  expect(out).toContain("0x9");
});
