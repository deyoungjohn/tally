"use client";

import { ExternalLink, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { encodeFunctionData, parseUnits } from "viem";
import type { PortfolioReport } from "@tally/engine";
import { USDT_BSC } from "@tally/config";
import { Button } from "@/components/motion/button";
import { Modal } from "@/components/motion/modal";
import { Segmented } from "@/components/motion/segmented";
import { checkRecipient } from "@/lib/address";
import { ERC20_TRANSFER_ABI } from "@/lib/erc20";
import { fmtUsd, shortHash } from "@/lib/format";
import { useJson } from "@/lib/hooks/use-json";
import { useTallyWallet } from "./wallet-context";

type Asset = "USDT" | "BNB";
/** Left in the wallet when sending "all" BNB, so there is still gas for the next transaction. */
const BNB_RESERVE = 0.0003;

/** Send USDT or BNB out of the signed-in wallet (how a tester gets their money back). BNB Smart Chain only. */
export function SendModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const wallet = useTallyWallet();
  const [asset, setAsset] = useState<Asset>("USDT");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<"form" | "confirm" | "sending" | "sent">("form");
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);

  const { data, reload } = useJson<PortfolioReport>(
    open && wallet.address ? `/api/portfolio?address=${wallet.address}` : null,
  );
  const balance = asset === "USDT" ? (data?.wallet.usdt ?? 0) : (data?.wallet.bnb ?? 0);

  useEffect(() => {
    if (open) {
      setStep("form");
      setError(null);
      setHash(null);
      setTo("");
      setAmount("");
    }
  }, [open]);

  const check = useMemo(() => checkRecipient(to, wallet.address), [to, wallet.address]);
  const recipientOk = check.ok;
  const n = Number(amount);
  const amountOk = n > 0 && n <= balance + 1e-12;
  const problem = useMemo(() => {
    if (to !== "" && !check.ok) return check.problem;
    if (amount !== "" && n > balance)
      return `You only have ${asset === "USDT" ? fmtUsd(balance) : balance.toFixed(5)} ${asset}.`;
    return null;
  }, [to, check, amount, n, balance, asset]);

  const max = () =>
    setAmount(
      asset === "USDT"
        ? String(Math.floor(balance * 1e6) / 1e6)
        : String(Math.max(0, Math.floor((balance - BNB_RESERVE) * 1e6) / 1e6)),
    );

  const send = async () => {
    setStep("sending");
    setError(null);
    try {
      // Validated again at the moment of sending, not only when the form was filled in.
      const again = checkRecipient(to, wallet.address);
      if (!again.ok) throw new Error(again.problem);
      const recipient = again.address;
      const wei = parseUnits(amount, 18);
      const h =
        asset === "USDT"
          ? await wallet.sendTx({
              to: USDT_BSC,
              data: encodeFunctionData({
                abi: ERC20_TRANSFER_ABI,
                functionName: "transfer",
                args: [recipient, wei],
              }),
            })
          : await wallet.sendTx({ to: recipient, data: "0x", value: wei });
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
      description="USDT or BNB, on BNB Smart Chain only."
    >
      {step === "sent" && hash ? (
        <div className="mt-3 grid gap-4" data-testid="send-done">
          <p className="text-fg2">
            Sent {amount} {asset}. It can take a few seconds to arrive.
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
            ]}
          />
          <p className="t-meta" data-testid="send-balance">
            Available: {asset === "USDT" ? fmtUsd(balance) : balance.toFixed(5)} {asset}
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
                  if (/^\d*\.?\d{0,6}$/.test(v)) setAmount(v);
                }}
                data-testid="send-amount"
              />
              <Button variant="glassy" type="button" onClick={max} disabled={step !== "form"}>
                Max
              </Button>
            </div>
          </label>
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
                  {amount} {asset}
                </b>{" "}
                to <span className="mono break-all text-[13.5px]">{to.trim()}</span> on BNB Smart
                Chain. This can&apos;t be undone, so check the address and that it accepts BNB Smart
                Chain (BEP-20).
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
