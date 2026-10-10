"use client";
// One line that shows one phrase at a time: the current one slides up and out while the next slides in from below. The box is as
// tall and wide as the longest phrase (all of them are laid out invisibly in the same cell), so nothing around it ever jumps.
// The phrase shown is chosen by the caller (`index`); screen readers get every phrase as plain text.

import { AnimatePresence, motion, useReducedMotion } from "motion/react";

export function RollingText({
  phrases,
  index,
  className,
}: {
  phrases: readonly string[];
  index: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
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
            key={phrases[index]}
            className="col-start-1 row-start-1 pb-[0.12em]"
            style={{ position: "absolute", inset: 0 }}
            initial={reduce ? false : { y: "100%", opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={reduce ? undefined : { y: "-100%", opacity: 0 }}
            transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
            data-testid="rolling-current"
          >
            {phrases[index]}
          </motion.span>
        </AnimatePresence>
      </span>
    </span>
  );
}
