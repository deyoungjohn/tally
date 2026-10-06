"use client";

import type { ReactNode } from "react";

/**
 * A slider for "how much of what I have". `value` is 0 to 100; the caller turns it into an amount (exact bigint maths where it
 * matters) and derives `value` back from the amount, so typing an amount moves the slider and the other way round.
 */
export function PercentSlider({
  value,
  onChange,
  label,
  available,
  disabled,
  testId = "percent-slider",
}: {
  value: number;
  onChange: (percent: number) => void;
  /** What the percentage is of, e.g. "USDT" or "NVDAB". */
  label: string;
  /** The full amount the slider is a share of, e.g. "12.5 USDT" or "0.0257 NVDAB (≈ 0.0257 shares)". */
  available?: ReactNode;
  disabled?: boolean;
  testId?: string;
}) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="grid gap-1" data-testid={testId}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={`${testId}-input`} className="t-meta">
          Use <b className="num text-fg">{v}%</b> of your {label}
        </label>
        {available ? (
          <span className="t-meta text-right" data-testid={`${testId}-available`}>
            {available}
          </span>
        ) : null}
      </div>
      <input
        id={`${testId}-input`}
        type="range"
        min={0}
        max={100}
        step={1}
        value={v}
        disabled={disabled}
        className="pct-slider"
        style={{ "--p": `${v}%` } as React.CSSProperties}
        aria-valuetext={`${v} percent of your ${label}`}
        onChange={(e) => onChange(Number(e.target.value))}
        data-testid={`${testId}-input`}
      />
    </div>
  );
}

/** Percent (0 to 100) that `part` is of `whole`, bigint-exact, clamped. */
export function percentOf(part: bigint | null, whole: bigint | null): number {
  if (part === null || whole === null || whole <= 0n || part <= 0n) return 0;
  const p = Number((part * 10000n) / whole) / 100;
  return Math.max(0, Math.min(100, p));
}
