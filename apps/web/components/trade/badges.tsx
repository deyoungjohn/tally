import { AlertTriangle, Pause } from "lucide-react";
import type { Grade } from "@/lib/dto";
import { SESSION_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Tip } from "@/components/ui/tooltip";

const GRADE_TIP: Record<string, string> = {
  A: "Grade A: plenty of trading and no data problems found.",
  B: "Grade B: healthy, with a minor note in Radar.",
  C: "Grade C: something looks thin or inconsistent. The reasons are in Radar.",
  D: "Grade D: several checks failed. Buy with care.",
  F: "Grade F: serious problems with this token's data or market.",
};

export function GradeBadge({
  grade,
  className,
  inButton,
}: {
  grade: Grade;
  className?: string;
  /** True when the badge sits inside a button, where it cannot take keyboard focus. */
  inButton?: boolean;
}) {
  const tone = grade === "A" || grade === "B" ? "grade-ab" : grade === "C" ? "grade-c" : "grade-df";
  return (
    <Tip text={GRADE_TIP[grade] ?? `Integrity grade ${grade}`} focusable={!inButton}>
      <span
        className={cn("grade", tone, className)}
        role="img"
        aria-label={`Integrity grade ${grade}`}
      >
        {grade}
      </span>
    </Tip>
  );
}

const isLiquid = (grade: Grade) => grade === "A" || grade === "B";

/** Liquid (grade A or B) or Low Liquidity (C to F). */
export function LiquidityBadge({ grade }: { grade: Grade }) {
  return isLiquid(grade) ? (
    <Tip text="Liquid: plenty of trading and no data problems found (grade A or B).">
      <span className="badge badge-up">Liquid</span>
    </Tip>
  ) : (
    <Tip text="Low Liquidity: trading is thin or the data is inconsistent (grade C to F). The reasons are listed below.">
      <span className="badge badge-amber">Low Liquidity</span>
    </Tip>
  );
}

export function TokenLogo({ ticker }: { ticker: string }) {
  return (
    <span className="token-logo" aria-hidden>
      {ticker === "USDT" ? "₮" : ticker.slice(0, 2)}
    </span>
  );
}

/** Colour is never the only signal (DESIGN §2.1): every badge carries words, and paused/ghost carry an icon. */
const SESSION_TIP: Record<string, string> = {
  regular: "US stock markets are open, so the reference price is live.",
  premarket: "US pre-market trading. The reference price is thinner than in regular hours.",
  postmarket: "US after-hours trading. The reference price is thinner than in regular hours.",
  overnight: "US markets are in the overnight session. Prices can be stale or thin.",
  closed:
    "US markets are closed. The reference price is the last close, so token prices can drift from it.",
  unknown: "Tally could not tell whether US markets are open.",
};

export function SessionBadge({ session }: { session: string }) {
  const label = SESSION_LABEL[session] ?? SESSION_LABEL.unknown!;
  const tone =
    session === "regular"
      ? "badge-up"
      : session === "premarket" || session === "postmarket"
        ? "badge-blue"
        : "";
  return (
    <Tip text={SESSION_TIP[session] ?? SESSION_TIP.unknown!}>
      <span className={cn("badge", tone)}>
        {session === "regular" ? <span className="dot-live" aria-hidden /> : null}
        {label}
      </span>
    </Tip>
  );
}

export function FlagBadge({ flag, inButton }: { flag: string; inButton?: boolean }) {
  if (flag === "ghost")
    return (
      <Tip
        focusable={!inButton}
        text="Not Tradable: under $1,000 traded in the last 24 hours, so the price can be days stale. Tally does not let you buy it."
      >
        <span className="badge badge-red">
          <AlertTriangle size={12} aria-hidden /> Not Tradable
        </span>
      </Tip>
    );
  if (flag === "unit-trap")
    return (
      <Tip text="Unit trap: one token is more than one share, so its price and balance look off by that factor. Tally always shows shares.">
        <span className="badge badge-amber">
          <AlertTriangle size={12} aria-hidden /> Unit trap
        </span>
      </Tip>
    );
  if (flag === "paused")
    return (
      <Tip text="Paused: the issuer has paused this token, so it cannot be bought or sold right now.">
        <span className="badge badge-red">
          <Pause size={12} aria-hidden /> Paused
        </span>
      </Tip>
    );
  return null;
}
