"use client";

import { ExternalLink, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { encodeFunctionData, formatUnits, parseUnits } from "viem";
import type { HoldingsReport, PortfolioReport, WalletToken } from "@tally/engine";
import { USDT_BSC } from "@tally/config";
import { Button } from "@/components/motion/button";
import { Modal } from "@/components/motion/modal";
import { Segmented } from "@/components/motion/segmented";
import { checkRecipient } from "@/lib/address";
import { ERC20_TRANSFER_ABI } from "@/lib/erc20";
import { ISSUER_LABEL, fmtShares, fmtUsd, shortHash } from "@/lib/format";
import { useJson } from "@/lib/hooks/use-json";
import { cn } from "@/lib/utils";
import { PercentSlider, percentOf } from "@/components/ui/percent-slider";
import { useTallyWallet } from "./wallet-context";

type Asset = "USDT" | "BNB" | "STOCK";
/** Left in the wallet when sending "all" BNB, so there is still gas for the next transaction. */
const BNB_RESERVE = 0.0003;

/** Send USDT, BNB or any tokenized stock token out of the signed-in wallet (how a tester gets their money back). BNB Smart Chain only. */
export function SendModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const wallet = useTallyWallet();
  const [asset, setAsset] = useState<Asset>("USDT");
  const [tokenAddr, setTokenAddr] = useState<string | null>(null);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<"form" | "confirm" | "sending" | "sent">("form");
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);

  const { data, reload } = useJson<PortfolioReport>(
    open && wallet.address ? `/api/portfolio?address=${wallet.address}` : null,
  );
  const held = useJson<HoldingsReport>(
    open && wallet.address ? `/api/holdings?address=${wallet.address}` : null,
  );
  const tokens = useMemo(
    () => [...(held.data?.tokens ?? [])].sort((x, y) => x.symbol.localeCompare(y.symbol)),
    [held.data],
  );
  const token: WalletToken | undefined = tokens.find((t) => t.address === tokenAddr) ?? undefined;

  // What is being sent, in exact units: raw balance (bigint), decimals and the name shown to the person.
  const unit = useMemo(() => {
    if (asset === "STOCK")
      return token
        ? { symbol: token.symbol, decimals: token.decimals, raw: BigInt(token.balanceRaw) }
        : null;
    const n = asset === "USDT" ? (data?.wallet.usdt ?? 0) : (data?.wallet.bnb ?? 0);
    const floored = Math.floor(n * 1e6) / 1e6;
    return { symbol: asset, decimals: 18, raw: parseUnits(floored.toFixed(6), 18) };
  }, [asset, token, data]);
  const balanceText = unit ? formatUnits(unit.raw, unit.decimals) : "0";
  const shownBalance = (raw: bigint, decimals: number) => {
    const v = Number(formatUnits(raw, decimals));
    return v >= 1
      ? v.toLocaleString("en-US", { maximumFractionDigits: 4 })
      : String(Number(v.toFixed(8)));
  };

  useEffect(() => {
    if (open) {
      setStep("form");
      setError(null);
      setHash(null);
      setTo("");
      setAmount("");
      setAsset("USDT");
      setTokenAddr(null);
    }
  }, [open]);

  const check = useMemo(() => checkRecipient(to), [to]);
  const recipientOk = check.ok;
  const amountRaw = useMemo(() => {
    if (!unit || amount === "" || amount === ".") return null;
    try {
      return parseUnits(amount, unit.decimals);
    } catch {
      return null;
    }
  }, [amount, unit]);
  const amountOk = !!unit && amountRaw !== null && amountRaw > 0n && amountRaw <= unit.raw;
  const problem = useMemo(() => {
    if (to !== "" && !check.ok) return check.problem;
    if (unit && amountRaw !== null && amountRaw > unit.raw)
      return `You only have ${shownBalance(unit.raw, unit.decimals)} ${unit.symbol}.`;
    return null;
  }, [to, check, unit, amountRaw]);

  /** The most that can be sent: everything, except for BNB, where a little stays for the next transaction's gas. */
  const maxRaw = useMemo(() => {
    if (!unit) return 0n;
    if (asset !== "BNB") return unit.raw;
    const keep = parseUnits(String(BNB_RESERVE), 18);
    return unit.raw > keep ? unit.raw - keep : 0n;
  }, [asset, unit]);
  const max = () => {
    if (unit) setAmount(formatUnits(maxRaw, unit.decimals));
  };
  const percent = percentOf(amountRaw, maxRaw);
  const setPercent = (p: number) => {
    if (!unit) return;
    setAmount(
      formatUnits(p >= 100 ? maxRaw : (maxRaw * BigInt(Math.round(p))) / 100n, unit.decimals),
    );
  };
  // The share count behind a tokenized stock balance (tokens × the issuer's multiplier), when the portfolio read has it.
  const stockShares =
    asset === "STOCK" && token
      ? data?.groups.flatMap((g) => g.parts).find((x) => x.address === token.address)?.shares
      : undefined;

  const send = async () => {
    setStep("sending");
    setError(null);
    try {
      // Validated again at the moment of sending, not only when the form was filled in.
      const again = checkRecipient(to);
      if (!again.ok) throw new Error(again.problem);
      const recipient = again.address;
      if (!unit || amountRaw === null || amountRaw <= 0n || amountRaw > unit.raw)
        throw new Error("Invalid amount");
      // Token contracts come only from the registry list the server returned, never from what is typed here.
      const contract = asset === "USDT" ? USDT_BSC : asset === "STOCK" ? token?.address : undefined;
      if (asset === "STOCK" && !contract) throw new Error("Unknown token");
      const h = contract
        ? await wallet.sendTx({
            to: contract as `0x${string}`,
            data: encodeFunctionData({
              abi: ERC20_TRANSFER_ABI,
              functionName: "transfer",
              args: [recipient, amountRaw],
            }),
          })
        : await wallet.sendTx({ to: recipient, data: "0x", value: amountRaw });
      setHash(h);
      setStep("sent");
      reload();
    } catch (e) {
      const rejected = (e as { code?: number }).code === 4001;
      setError(
        rejected
          ? "You cancelled in your wallet. Nothing was sent."
          : "The transfer didn't go through. Nothing was sent.",
      );
      setStep("confirm");
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Send from your wallet"
      description="USDT, BNB or any tokenized stock, on BNB Smart Chain only."
    >
      {step === "sent" && hash ? (
        <div className="mt-3 grid gap-4" data-testid="send-done">
          <p className="text-fg2">
            Sent {amount} {unit?.symbol ?? ""}. It can take a few seconds to arrive.
          </p>
          <a
            className="btn btn-glassy"
            href={`https://bscscan.com/tx/${hash}`}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink size={16} aria-hidden /> BscScan{" "}
            <span className="mono text-[13px] text-fg2">{shortHash(hash)}</span>
          </a>
          <Button onClick={onClose}>Done</Button>
        </div>
      ) : (
        <div className="mt-3 grid gap-4">
          <Segmented
            label="What to send"
            value={asset}
            onChange={(a) => {
              setAsset(a);
              setAmount("");
            }}
            options={[
              { value: "USDT", label: "USDT" },
              { value: "BNB", label: "BNB" },
              { value: "STOCK", label: "Tokenized stocks" },
            ]}
          />
          {asset === "STOCK" ? (
            <div
              role="radiogroup"
              aria-label="Which tokenized stock to send"
              className="grid max-h-[220px] gap-1.5 overflow-y-auto overscroll-contain"
              data-testid="send-token-list"
            >
              {held.loading && !held.data ? (
                <p className="t-meta">Looking up your tokenized stocks…</p>
              ) : tokens.length === 0 ? (
                <p className="t-meta" data-testid="send-no-tokens">
                  {held.error ?? "This wallet holds no tokenized stocks."}
                </p>
              ) : (
                tokens.map((t) => (
                  <button
                    key={t.address}
                    type="button"
                    role="radio"
                    aria-checked={t.address === tokenAddr}
                    disabled={step !== "form"}
                    onClick={() => {
                      setTokenAddr(t.address);
                      setAmount("");
                    }}
                    data-testid={`send-token-${t.symbol}`}
                    className={cn(
                      "panel flex min-h-[48px] items-center justify-between gap-3 px-4 text-left",
                      t.address === tokenAddr && "!bg-[var(--hl)]",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="font-semibold">{t.symbol}</span>{" "}
                      <span className="text-[13.5px] text-fg3">{ISSUER_LABEL[t.issuer]}</span>
                    </span>
                    <span className="num text-fg2">
                      {shownBalance(BigInt(t.balanceRaw), t.decimals)}
                    </span>
                  </button>
                ))
              )}
            </div>
          ) : null}
          <p className="t-meta" data-testid="send-balance">
            Available:{" "}
            {unit
              ? asset === "USDT"
                ? fmtUsd(Number(balanceText))
                : `${shownBalance(unit.raw, unit.decimals)} ${unit.symbol}${stockShares === undefined ? "" : ` (${fmtShares(stockShares)} shares)`}`
              : "choose a token"}
            {asset === "USDT" ? " USDT" : ""}
          </p>
          <label className="block">
            <span className="t-meta">To (wallet address)</span>
            <input
              className="input mono mt-1"
              placeholder="0x…"
              value={to}
              disabled={step !== "form"}
              onChange={(e) => setTo(e.target.value.replace(/\s+/g, ""))}
              aria-invalid={to !== "" && !recipientOk}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              aria-describedby="send-to-problem"
              data-testid="send-to"
            />
          </label>
          <label className="block">
            <span className="t-meta">Amount</span>
            <div className="mt-1 flex gap-2">
              <input
                className="input"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                disabled={step !== "form"}
                onChange={(e) => {
                  const v = e.target.value.replace(",", ".");
                  const places = unit?.decimals ?? 6;
                  if (new RegExp(`^\\d*\\.?\\d{0,${places}}$`).test(v)) setAmount(v);
                }}
                data-testid="send-amount"
              />
              <Button
                variant="glassy"
                type="button"
                onClick={max}
                disabled={step !== "form" || !unit}
              >
                Max
              </Button>
            </div>
          </label>
          <PercentSlider
            value={percent}
            onChange={setPercent}
            label={unit?.symbol ?? "balance"}
            disabled={step !== "form" || !unit || maxRaw === 0n}
            testId="send-slider"
          />
          {problem ? (
            <p role="alert" id="send-to-problem" className="text-[14.5px] text-red">
              {problem}
            </p>
          ) : null}
          {step === "form" ? (
            <Button
              disabled={!recipientOk || !amountOk}
              onClick={() => setStep("confirm")}
              data-testid="send-review"
            >
              <Send size={16} aria-hidden /> Review
            </Button>
          ) : (
            <div className="grid gap-3">
              <div className="rounded-[16px] border border-[rgba(242,193,78,.3)] bg-[rgba(242,193,78,.08)] p-4 text-[15px]">
                You are sending{" "}
                <b>
                  {amount} {unit?.symbol ?? ""}
                </b>{" "}
                to <span className="mono break-all text-[13.5px]">{to.trim()}</span> on BNB Smart
                Chain. This can&apos;t be undone, so check the address and that it accepts{" "}
                <b>{unit?.symbol ?? "this token"}</b> on BNB Smart Chain (BEP-20).
              </div>
              {error ? (
                <p role="alert" className="text-[14.5px] text-red">
                  {error}
                </p>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="glassy"
                  onClick={() => setStep("form")}
                  disabled={step === "sending"}
                >
                  Back
                </Button>
                <Button
                  onClick={() => void send()}
                  disabled={step === "sending"}
                  data-testid="send-confirm"
                >
                  {step === "sending" ? "Sending…" : "Confirm send"}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
