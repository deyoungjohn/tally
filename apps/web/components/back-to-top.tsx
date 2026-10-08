"use client";
// A small floating arrow, bottom right on every page, that returns to the top. It appears once the page has been scrolled
// a little (Radar alone has hundreds of cards). Liquid glass with a 1% fill, like the nav bar.

import { ArrowUp } from "lucide-react";
import { useEffect, useState } from "react";

const SHOW_AFTER_PX = 320;

export function BackToTop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > SHOW_AFTER_PX);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <button
      type="button"
      aria-label="Back to top"
      data-testid="back-to-top"
      data-visible={show}
      tabIndex={show ? 0 : -1}
      aria-hidden={!show}
      className="back-to-top"
      onClick={() => {
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
      }}
    >
      <ArrowUp size={20} aria-hidden />
    </button>
  );
}
