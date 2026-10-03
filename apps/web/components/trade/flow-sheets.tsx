"use client";

import { AlertTriangle, Check, Copy, ExternalLink, Lock, ShieldCheck, Wallet } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/motion/modal";
import { Button } from "@/components/motion/button";
import { DynamicIsland, DynamicIslandView } from "@/components/motion/dynamic-island";
import { useTallyWallet } from "@/components/wallet/wallet-context";
import { DECLARATION_TEXT, DECLARATION_VERSION } from "@/lib/declaration";
import type { PlanDto, ReceiptDto } from "@/lib/dto";
import { fmtPct, fmtShares, fmtUsd, fromWei, shortHash } from "@/lib/format";
import { ISSUER_LABEL } from "@/lib/format";
import { fetchPlan, progressOf, type FlowParams, type FlowPhase } from "./use-trade-flow";

/* ------------------------------------------------------------------ progress */

const VIEW_TEXT: Record<string, string> = {
  quote: "Getting your price",
  approve: "Approve USDT in your wallet",
  swap: "Buying your shares",
  done: "Shares delivered",
};

/**
 * Top-of-screen progress pill: Quoting → Approve → Swap → Confirmed (DESIGN §3.2), beUI's dynamic-island on a translucent glass shell.
 * It slides and blurs in from above and out again; its content is a fixed width so nothing is ever clipped while it morphs.
 */
export function ProgressIsland({ phase }: { phase: FlowPhase }) {
  const { view, step } = progressOf(phase);
  const reduce = useReducedMotion();
  // The "delivered" pill rests for a few seconds, then leaves; the receipt card stays.
  const [doneGone, setDoneGone] = useState(false);
  useEffect(() => {
    setDoneGone(false);
    if (phase.name !== "done") return;
    const t = setTimeout(() => setDoneGone(true), 4_000);
    return () => clearTimeout(t);
  }, [phase.name]);
  const showing =
    view !== null &&
    phase.name !== "review" &&
    phase.name !== "topup" &&
    !(phase.name === "done" && doneGone);
  const label =
    phase.name === "approve" && phase.step === "mining"
      ? "Approving…"
      : phase.name === "swap" && phase.step === "sign"
        ? "Confirm in your wallet"
        : view
          ? VIEW_TEXT[view]
          : "";
  // Keep the last view while the pill leaves, so it fades out with its words instead of an empty shell.
  const last = useRef({ view, label, step });
  if (showing) last.current = { view, label, step };
  const shown = last.current;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[84px] z-[60] flex justify-center px-4">
      <AnimatePresence>
        {showing ? (
          <motion.div
            key="island"
            className="pointer-events-auto"
            data-testid="progress-island"
            initial={
              reduce ? { opacity: 0 } : { opacity: 0, y: -18, scale: 0.94, filter: "blur(8px)" }
            }
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
            exit={
              reduce ? { opacity: 0 } : { opacity: 0, y: -14, scale: 0.96, filter: "blur(8px)" }
            }
            transition={
              reduce ? { duration: 0.15 } : { type: "spring", duration: 0.55, bounce: 0.25 }
            }
          >
            <DynamicIsland
              view={shown.view}
              className="island-glass"
              contentClassName="min-w-[min(320px,calc(100vw-56px))]"
            >
              {Object.keys(VIEW_TEXT).map((id) => (
                <DynamicIslandView
                  key={id}
                  id={id}
                  className="w-[min(320px,calc(100vw-56px))] flex-col items-stretch gap-3 !px-6 !py-4"
                >
                  <span
                    className="text-center text-[14px] font-semibold"
                    aria-label={`Step ${shown.step} of 4: ${shown.label}`}
                  >
                    {shown.label}
                  </span>
                  <span className="seg-bar" aria-hidden>
                    {[1, 2, 3, 4].map((n) => (
                      <i key={n} className={n <= shown.step ? "on" : ""} />
                    ))}
                  </span>
                </DynamicIslandView>
              ))}
            </DynamicIsland>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------- sign-in */

const DECL_KEY = `tally.declaration.${DECLARATION_VERSION}`;

export function SignInSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const wallet = useTallyWallet();
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    try {
      if (localStorage.getItem(DECL_KEY) === "1") setAgree(true);
    } catch {
      /* private mode: the user just ticks it again */
    }
  }, [open]);

  const go = async () => {
    setBusy(true);
    try {
      await fetch("/api/declaration", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: DECLARATION_VERSION, accepted: true }),
      });
      try {
        localStorage.setItem(DECL_KEY, "1");
      } catch {
        /* ignore */
      }
      wallet.login();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title="Create your account">
      <p className="mt-1 text-fg2">
        Sign in with your email or Google. We make you a wallet in a few seconds. No crypto
        experience needed.
      </p>
      <label className="panel mt-5 flex cursor-pointer items-start gap-3 p-4 text-[14px] leading-snug">
        <input
          type="checkbox"
          checked={agree}
          onChange={(e) => setAgree(e.target.checked)}
          className="mt-0.5 h-5 w-5 flex-none accent-[#e8ebef]"
          data-testid="declaration"
        />
        <span>{DECLARATION_TEXT}</span>
      </label>
      <div className="mt-5 grid gap-3">
        <Button big disabled={!agree || busy || !wallet.ready} onClick={go}>
          <Lock size={16} aria-hidden /> Continue
        </Button>
        <p className="t-meta text-center">
          Already have a crypto wallet? You can connect it on the next screen.
        </p>
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------------- top-up */

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="glassy"
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        } catch {
          /* clipboard blocked: the address is visible and selectable */
        }
      }}
    >
      {done ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
      {done ? "Copied" : "Copy"}
    </Button>
  );
}

function Qr({ text }: { text: string }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    let live = true;
    void import("qrcode").then((q) =>
      q
        .toDataURL(text, { margin: 1, width: 168, color: { dark: "#0b0c0e", light: "#f4f5f6" } })
        .then((u) => live && setSrc(u)),
    );
    return () => {
      live = false;
    };
  }, [text]);
  return src ? (
    <img
      src={src}
      width={168}
      height={168}
      alt="QR code of your wallet address"
      className="rounded-2xl"
    />
  ) : (
    <div className="skeleton h-[168px] w-[168px]" />
  );
}

/** Top-up tiers 1 and 2 (blueprint §8.2): deposit to the address, or connect a funded wallet. Watches the balance and continues by itself. */
export function TopUpSheet({
  plan,
  params,
  onFunded,
  onClose,
}: {
  plan: PlanDto | null;
  params: FlowParams;
  onFunded: () => void;
  onClose: () => void;
}) {
  const wallet = useTallyWallet();
  const [live, setLive] = useState<PlanDto | null>(plan);
  const funded = useRef(onFunded);
  funded.current = onFunded;
  const open = plan !== null;

  useEffect(() => {
    if (!open || !wallet.address) return;
    setLive(plan);
    const addr = wallet.address;
    const t = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      fetchPlan(params, addr)
        .then((p) => {
          if (p.status === "needs_funds") setLive(p);
          else funded.current();
        })
        .catch(() => undefined);
    }, 5_000);
    return () => clearInterval(t);
  }, [open, wallet.address, params, plan]);

  const p = live ?? plan;
  const usdtNeed = p?.shortfall ? fromWei(p.shortfall.usdt) : 0;
  const bnbNeed = p?.shortfall ? fromWei(p.shortfall.bnb) : 0;
  const address = wallet.address ?? "";

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title="Add funds to buy">
      {p ? (
        <div className="mt-1 grid gap-4">
          <p className="text-fg2" data-testid="topup-need">
            You have {fmtUsd(fromWei(p.balances.usdt))} USDT and{" "}
            {fromWei(p.balances.bnb).toFixed(5)} BNB.{" "}
            {usdtNeed > 0 ? (
              <>
                Add at least <b className="text-fg">{fmtUsd(usdtNeed)} USDT</b>.{" "}
              </>
            ) : null}
            {bnbNeed > 0 ? (
              <>
                Add about <b className="text-fg">$0.10 of BNB</b> for network fees.{" "}
              </>
            ) : null}
            We continue automatically when it arrives.
          </p>
          <div className="field flex flex-wrap items-center gap-4">
            {address ? <Qr text={address} /> : null}
            <div className="min-w-0 flex-1">
              <p className="t-meta">Your wallet address</p>
              <p className="mono truncate-mid mt-1 text-[13px]" data-testid="deposit-address">
                {address}
              </p>
              <div className="mt-3">
                <CopyButton text={address} label="Copy wallet address" />
              </div>
            </div>
          </div>
          <div
            role="alert"
            className="flex gap-3 rounded-[18px] border border-[rgba(242,193,78,.3)] bg-[rgba(242,193,78,.08)] p-4 text-[14px]"
          >
            <AlertTriangle size={18} className="mt-0.5 flex-none text-amber" aria-hidden />
            <p>
              Send only on <b>BNB Smart Chain (BEP-20)</b>. Money sent on any other network will be
              lost.
            </p>
          </div>
          <div className="panel p-4">
            <p className="font-semibold">Already have a funded wallet?</p>
            <p className="t-meta mt-1">Connect it and pay from there instead.</p>
            <div className="mt-3">
              <Button variant="glassy" onClick={() => wallet.connectExternal()}>
                <Wallet size={16} aria-hidden /> Connect a wallet
              </Button>
            </div>
          </div>
          <p className="t-meta flex items-center gap-2" role="status">
            <span className="dot-live" aria-hidden /> Waiting for your deposit…
          </p>
        </div>
      ) : null}
    </Modal>
  );
}

/* -------------------------------------------------------------------- review */

export function ReviewSheet({
  plan,
  notice,
  onConfirm,
  onClose,
}: {
  plan: PlanDto | null;
  notice?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!plan) return;
    const tick = () => setLeft(Math.max(0, Math.ceil((plan.expiresAt - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [plan]);

  const min = plan ? fromWei(plan.minShares) : 0;
  return (
    <Modal open={plan !== null} onOpenChange={(o) => !o && onClose()} title="Review your buy">
      {plan ? (
        <div className="mt-1 grid gap-4">
          {notice ? (
            <p
              role="status"
              className="rounded-[14px] bg-[rgba(242,193,78,.1)] px-4 py-3 text-[14px] text-amber"
            >
              {notice}
            </p>
          ) : null}
          <div className="field">
            <p className="t-meta">You&apos;ll get at least</p>
            <p className="t-big mt-1" data-testid="min-shares">
              {fmtShares(min)} <span className="text-[22px] text-fg2">{plan.ticker} shares</span>
            </p>
            <p className="mt-2 text-[14px] text-fg2">
              …or nothing happens. Tally checks this in shares, on-chain, before it keeps the trade.
            </p>
          </div>
          <dl>
            <div className="detail-row">
              <dt>You pay</dt>
              <dd>{fmtUsd(fromWei(plan.amountInUsdt))} USDT</dd>
            </div>
            <div className="detail-row">
              <dt>Expected</dt>
              <dd>{fmtShares(fromWei(plan.quotedShares))} shares</dd>
            </div>
            <div className="detail-row">
              <dt>Price per share</dt>
              <dd>{fmtUsd(plan.usdPerShare)}</dd>
            </div>
            <div className="detail-row">
              <dt>vs US price</dt>
              <dd>{fmtPct(plan.premium)}</dd>
            </div>
            <div className="detail-row">
              <dt>Network fee</dt>
              <dd>
                {plan.tx?.feeUsd === null || plan.tx?.feeUsd === undefined
                  ? "–"
                  : `≈ ${fmtUsd(plan.tx.feeUsd, 3)}`}
              </dd>
            </div>
            <div className="detail-row">
              <dt>Bought from</dt>
              <dd>
                {plan.symbol} ({ISSUER_LABEL[plan.issuer]})
              </dd>
            </div>
            <div className="detail-row">
              <dt>Tolerance</dt>
              <dd>{plan.tolerancePct}%</dd>
            </div>
          </dl>
          <p className="t-meta">
            Not investment advice. You sign this in your own wallet; Tally never holds your money.
            {left > 0
              ? ` This price is good for ${left}s.`
              : " We refresh the price when you confirm."}
          </p>
          <div className="grid gap-2">
            <Button big onClick={onConfirm} data-testid="confirm-buy">
              <ShieldCheck size={18} aria-hidden /> Confirm and buy
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

/* ------------------------------------------------------------------- receipt */

export function ReceiptCard({
  receipt,
  plan,
  ticker,
  symbol,
  onDismiss,
}: {
  receipt: ReceiptDto;
  plan?: PlanDto;
  ticker: string;
  symbol: string;
  onDismiss: () => void;
}) {
  const f = receipt.fill!;
  const shares = fromWei(f.shares);
  return (
    <section className="gcard" aria-labelledby="receipt-title" data-testid="receipt">
      <div className="flex items-center gap-3">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-up/20 text-up" aria-hidden>
          <Check size={16} />
        </span>
        <h2 id="receipt-title" className="text-lg font-semibold">
          Shares delivered
        </h2>
      </div>
      <p className="t-big mt-4" data-testid="receipt-shares">
        {fmtShares(shares)} <span className="text-[22px] text-fg2">{ticker} shares</span>
      </p>
      <dl className="mt-4">
        <div className="detail-row">
          <dt>You paid</dt>
          <dd>{fmtUsd(fromWei(f.amountInUsdt))} USDT</dd>
        </div>
        <div className="detail-row">
          <dt>Price per share</dt>
          <dd>{fmtUsd(f.usdPerShare)}</dd>
        </div>
        <div className="detail-row">
          <dt>vs US price</dt>
          <dd>{fmtPct(f.premium)}</dd>
        </div>
        <div className="detail-row">
          <dt>Tokens received</dt>
          <dd>
            {fromWei(f.tokensOut).toFixed(6)} {symbol}
          </dd>
        </div>
        <div className="detail-row">
          <dt>Network fee</dt>
          <dd>
            {receipt.gasUsd === null || receipt.gasUsd === undefined
              ? "–"
              : fmtUsd(receipt.gasUsd, 3)}
          </dd>
        </div>
        {plan ? (
          <div className="detail-row">
            <dt>Guaranteed at least</dt>
            <dd>{fmtShares(fromWei(plan.minShares))} shares</dd>
          </div>
        ) : null}
      </dl>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <a
          href={receipt.bscscan}
          target="_blank"
          rel="noreferrer"
          className="btn btn-glassy"
          aria-label="View transaction on BscScan (opens in a new tab)"
        >
          <ExternalLink size={16} aria-hidden /> BscScan{" "}
          <span className="mono text-[12px] text-fg2">{shortHash(receipt.txHash)}</span>
        </a>
        <Button variant="ghost" onClick={onDismiss}>
          Done
        </Button>
      </div>
    </section>
  );
}
