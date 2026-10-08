"use client";
// Adapted from beUI `tabs` (pill variant): a spring `layoutId` indicator gliding between options. Re-skinned with Tally tokens.
// Semantics are a radio group (one choice, arrow keys move it) because it switches a value, not a panel.

import { useRef, type KeyboardEvent } from "react";
import { Glide } from "@/components/motion/glide";
import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
  size = "md",
}: {
  value: T;
  onChange: (v: T) => void;
  options: SegmentedOption<T>[];
  label: string;
  className?: string;
  /** "lg" is for page-level tab switches. */
  size?: "md" | "lg";
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKey = (e: KeyboardEvent, i: number) => {
    const dir =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : 0;
    if (!dir) return;
    e.preventDefault();
    const next = (i + dir + options.length) % options.length;
    onChange(options[next]!.value);
    refs.current[next]?.focus();
  };

  return (
    // The pill is one element measured against this group (see glide.tsx), not a layoutId shared with the rest of the page,
    // so nothing elsewhere (the progress island mounting, dialogs closing, scroll) can displace it.
    <Glide
      role="radiogroup"
      aria-label={label}
      hover={false}
      pillStyle={{ background: "linear-gradient(180deg, var(--orange-hi), var(--orange))" }}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-[var(--edge)] bg-white/[0.05] p-1",
        className,
      )}
    >
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              size === "lg"
                ? "relative min-h-[46px] min-w-[96px] rounded-full px-7 text-[17px] font-semibold transition-colors"
                : "relative min-h-[36px] min-w-[44px] rounded-full px-4 text-[15px] font-semibold transition-colors",
              active ? "text-white" : "text-fg2 hover:text-fg",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </Glide>
  );
}
