import { AlertTriangle, Pause } from "lucide-react";
import type { Grade } from "@/lib/dto";
import { SESSION_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";

export function GradeBadge({ grade, className }: { grade: Grade; className?: string }) {
  const tone = grade === "A" || grade === "B" ? "grade-ab" : grade === "C" ? "grade-c" : "grade-df";
  return (
    <span
      className={cn("grade", tone, className)}
      role="img"
      aria-label={`Integrity grade ${grade}`}
      title={`Integrity grade ${grade}`}
    >
      {grade}
    </span>
  );
}

export function TokenLogo({ ticker }: { ticker: string }) {
  return (
    <span className="token-logo" aria-hidden>
      {ticker.slice(0, 4)}
    </span>
  );
}

/** Colour is never the only signal (DESIGN §2.1): every badge carries words, and paused/ghost carry an icon. */
export function SessionBadge({ session }: { session: string }) {
  const label = SESSION_LABEL[session] ?? SESSION_LABEL.unknown!;
  const tone =
    session === "regular"
      ? "badge-up"
      : session === "premarket" || session === "postmarket"
        ? "badge-blue"
        : "";
  return (
    <span className={cn("badge", tone)}>
      {session === "regular" ? <span className="dot-live" aria-hidden /> : null}
      {label}
    </span>
  );
}

export function FlagBadge({ flag }: { flag: string }) {
  if (flag === "ghost")
    return (
      <span className="badge badge-red">
        <AlertTriangle size={12} aria-hidden /> Ghost market
      </span>
    );
  if (flag === "unit-trap")
    return (
      <span className="badge badge-amber">
        <AlertTriangle size={12} aria-hidden /> Unit trap
      </span>
    );
  if (flag === "paused")
    return (
      <span className="badge badge-red">
        <Pause size={12} aria-hidden /> Paused
      </span>
    );
  return null;
}
