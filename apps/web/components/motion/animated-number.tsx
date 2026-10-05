"use client";
// Adapted from Spectrum UI's Number Ticker (ui.spectrumhq.in/r/number-ticker.json, Apache-2.0): every digit is a
// column that rolls to its new value, so a live reading ticks instead of jumping. Changes from the original:
// it formats decimals and arbitrary strings, keys glyphs by place value around the decimal point (a changing
// digit rolls rather than remounting), and reads as a plain number to screen readers. Tabular figures (DESIGN.md §2.9).

import { motion, useInView, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { EASE_OUT } from "@/lib/ease";
import { cn } from "@/lib/utils";

export interface NumberTickerProps {
  value: number;
  /** Per-digit roll duration in seconds. */
  duration?: number;
  /** Stagger between digits on the first reveal only. */
  stagger?: number;
  /** Fraction digits. */
  decimals?: number;
  /** Custom formatter; the ticker rolls whatever digits it returns. */
  format?: (n: number) => string;
  /** Wait until the element is on screen before the first reveal. */
  startOnView?: boolean;
  className?: string;
}

/** Existing call sites say AnimatedNumber; it is the same component. */
export type AnimatedNumberProps = NumberTickerProps;

const DIGIT_HEIGHT_EM = 1.1;
const DIGITS = Array.from({ length: 10 }, (_, n) => n);

export function NumberTicker({
  value,
  duration = 0.8,
  stagger = 0.03,
  decimals = 0,
  format,
  startOnView = true,
  className,
}: NumberTickerProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const [entered, setEntered] = useState(false);
  const armed = !startOnView || inView;

  const text = useMemo(
    () =>
      format
        ? format(value)
        : value.toLocaleString("en-US", {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
          }),
    [value, decimals, format],
  );

  const glyphs = useMemo(() => {
    const dot = text.indexOf(".");
    const intLen = dot === -1 ? text.length : dot;
    return text.split("").map((char, i) => ({
      char,
      // Place value: integer glyphs count from the decimal point leftward, fraction glyphs rightward.
      id: i < intLen ? `i${intLen - 1 - i}` : `f${i - intLen}`,
    }));
  }, [text]);

  // The stagger is an entrance flourish; later value changes roll every digit at once.
  useEffect(() => {
    if (!armed || entered) return;
    const t = window.setTimeout(
      () => setEntered(true),
      (duration + glyphs.length * stagger) * 1000,
    );
    return () => window.clearTimeout(t);
  }, [armed, entered, duration, stagger, glyphs.length]);

  return (
    <span
      ref={ref}
      className={cn("inline-flex items-center tabular-nums", className)}
      // An inline-flex box of clipped digit columns takes its baseline from its bottom edge, which sits about
      // 0.22em below the glyphs. Lowering it by that much puts the digits on the surrounding text's baseline.
      style={{ verticalAlign: "-0.22em" }}
    >
      <span className="sr-only">{text}</span>
      <span aria-hidden="true" className="inline-flex items-center">
        {glyphs.map(({ char, id }, i) =>
          /\d/.test(char) ? (
            <Digit
              key={id}
              digit={armed ? Number(char) : 0}
              delay={entered ? 0 : i * stagger}
              duration={duration}
            />
          ) : (
            <span key={id} className="inline-block">
              {char}
            </span>
          ),
        )}
      </span>
    </span>
  );
}

function Digit({ digit, delay, duration }: { digit: number; delay: number; duration: number }) {
  const reduce = useReducedMotion();
  return (
    <span
      className="relative inline-block overflow-hidden"
      style={{ height: `${DIGIT_HEIGHT_EM}em`, width: "1ch" }}
    >
      <motion.span
        initial={{ y: 0 }}
        animate={{ y: `-${digit * DIGIT_HEIGHT_EM}em` }}
        transition={reduce ? { duration: 0 } : { duration, delay, ease: EASE_OUT }}
        className="absolute inset-x-0 top-0 flex flex-col items-center will-change-transform"
      >
        {DIGITS.map((n) => (
          <span key={n} className="flex h-[1.1em] items-center justify-center leading-none">
            {n}
          </span>
        ))}
      </motion.span>
    </span>
  );
}

export const AnimatedNumber = NumberTicker;
