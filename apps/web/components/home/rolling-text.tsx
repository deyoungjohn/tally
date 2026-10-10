"use client";
// One line that cycles through phrases: the current one slides up and out while the next slides in from below. The box is as
// tall and wide as the longest phrase (all of them are laid out invisibly in the same cell), so nothing around it ever jumps.
// With reduced motion it stays on the first phrase and never loops; screen readers get every phrase as plain text.

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

export function RollingText({
  phrases,
  intervalMs = 2800,
  className,
}: {
  phrases: readonly string[];
  intervalMs?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reduce || phrases.length < 2) return;
    const id = window.setInterval(() => setI((n) => (n + 1) % phrases.length), intervalMs);
    return () => window.clearInterval(id);
  }, [reduce, phrases.length, intervalMs]);

  return (
    <span className={className} data-testid="rolling-text">
      <span className="sr-only">{phrases.join(". ")}.</span>
      <span aria-hidden className="relative grid overflow-hidden">
        {phrases.map((p) => (
          <span key={p} className="invisible col-start-1 row-start-1 pb-[0.12em]">
            {p}
          </span>
        ))}
        <AnimatePresence initial={false}>
          <motion.span
            key={phrases[i]}
            className="col-start-1 row-start-1 pb-[0.12em]"
            style={{ position: "absolute", inset: 0 }}
            initial={reduce ? false : { y: "100%", opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={reduce ? undefined : { y: "-100%", opacity: 0 }}
            transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
            data-testid="rolling-current"
          >
            {phrases[i]}
          </motion.span>
        </AnimatePresence>
      </span>
    </span>
  );
}
