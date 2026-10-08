"use client";

import { ArrowDown } from "lucide-react";

/** Jumps to the "How a grade is made" section at the bottom of Radar, which sits below hundreds of cards. */
export function HowWeGradeLink() {
  return (
    <a
      href="#how-we-grade"
      data-testid="how-we-grade-link"
      className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 text-[14.5px] text-orange-text"
      onClick={(e) => {
        const el = document.getElementById("how-we-grade");
        if (!el) return;
        e.preventDefault();
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
        el.focus({ preventScroll: true });
      }}
    >
      How we grade tokens <ArrowDown size={14} aria-hidden />
    </a>
  );
}
