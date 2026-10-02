"use client";
// Adapted from beUI `tabs` (pill variant): a spring `layoutId` indicator gliding between options. Re-skinned with Tally tokens.
// Semantics are a radio group (one choice, arrow keys move it) because it switches a value, not a panel.

import { motion, MotionConfig, useReducedMotion } from "motion/react";
import { useId, useRef, type KeyboardEvent } from "react";
import { SPRING_LAYOUT } from "@/lib/ease";
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
}: {
  value: T;
  onChange: (v: T) => void;
  options: SegmentedOption<T>[];
  label: string;
  className?: string;
}) {
  const layoutId = useId();
  const reduce = useReducedMotion();
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
    <MotionConfig transition={reduce ? { duration: 0 } : SPRING_LAYOUT}>
      <div
        role="radiogroup"
        aria-label={label}
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
                "relative min-h-[36px] min-w-[44px] rounded-full px-4 text-[14px] font-semibold transition-colors",
                active ? "text-[var(--silver-ink)]" : "text-fg2 hover:text-fg",
              )}
            >
              {active ? (
                <motion.span
                  layoutId={layoutId}
                  aria-hidden
                  className="absolute inset-0 rounded-full"
                  style={{ background: "var(--silver)" }}
                />
              ) : null}
              <span className="relative">{o.label}</span>
            </button>
          );
        })}
      </div>
    </MotionConfig>
  );
}
