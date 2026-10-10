"use client";
// The hero's rolling line and the card beside it move together: when the phrase changes, the card shows that feature. The first
// card is the real, live trade card; the others are labelled samples. Rotation stops for good once someone touches the card or picks
// a dot (so typing is never interrupted), pauses while the pointer is over the card, and never starts with reduced motion.

import { useReducedMotion } from "motion/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { RollingText } from "./rolling-text";
import { HeroSamples } from "./hero-samples";

export const HERO_PHRASES = [
  "Trade at the best prices",
  "Migrate across issuers seamlessly",
  "Receive alerts about your holdings",
  "Buy stock baskets without hassle",
  "Spot liquid tokens at a glance and avoid unit traps",
] as const;
const ROTATE_MS = 3800;

interface Stage {
  index: number;
  select: (i: number) => void;
  pin: () => void;
  hover: (on: boolean) => void;
}
const Ctx = createContext<Stage | null>(null);
const useStage = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("HeroStage is missing");
  return v;
};

export function HeroStage({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [pinned, setPinned] = useState(false);
  const [hovering, setHovering] = useState(false);
  useEffect(() => {
    // Browsers driven by automation (navigator.webdriver) never auto-rotate, so a script that types into the card is not
    // interrupted; real visitors are unaffected.
    if (reduce || pinned || hovering || navigator.webdriver) return;
    const id = window.setInterval(() => setIndex((n) => (n + 1) % HERO_PHRASES.length), ROTATE_MS);
    return () => window.clearInterval(id);
  }, [reduce, pinned, hovering]);
  const select = useCallback((i: number) => {
    setPinned(true);
    setIndex(i);
  }, []);
  const value = useMemo<Stage>(
    () => ({ index, select, pin: () => setPinned(true), hover: setHovering }),
    [index, select],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The orange rolling line under the headline. */
export function HeroLine() {
  const { index } = useStage();
  return <RollingText phrases={HERO_PHRASES} index={index} />;
}

/** The card column: every card sits in the same grid cell, so the column is as tall as the tallest and never jumps. */
export function HeroPanels({ trade }: { trade: React.ReactNode }) {
  const { index, select, pin, hover } = useStage();
  const panels = [trade, ...HeroSamples];
  return (
    <div
      onPointerEnter={() => hover(true)}
      onPointerLeave={() => hover(false)}
      onPointerDown={pin}
      onFocusCapture={pin}
    >
      <div className="grid" data-testid="hero-panels">
        {panels.map((node, i) => (
          <div
            key={i}
            className={cn(
              "col-start-1 row-start-1 min-w-0 transition-[opacity,transform] duration-500 motion-reduce:transition-none",
              i === index
                ? "translate-y-0 opacity-100"
                : "pointer-events-none translate-y-3 opacity-0",
            )}
            aria-hidden={i !== index}
            inert={i !== index}
            data-testid={`hero-panel-${i}`}
            data-active={i === index}
          >
            {node}
          </div>
        ))}
      </div>
      <div className="mt-5 flex justify-center gap-2" role="group" aria-label="Show a feature">
        {HERO_PHRASES.map((p, i) => (
          <button
            key={p}
            type="button"
            onClick={() => select(i)}
            aria-label={p}
            aria-current={i === index}
            data-testid={`hero-dot-${i}`}
            className="grid h-6 w-6 place-items-center rounded-full"
          >
            <span
              className={cn(
                "block h-2 rounded-full transition-all duration-300 motion-reduce:transition-none",
                i === index ? "w-6 bg-[var(--orange)]" : "w-2 bg-white/30",
              )}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
