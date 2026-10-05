"use client";
// A small tooltip for tags: hover or keyboard focus on desktop, tap on touch. Rendered in a portal and clamped to the
// viewport, so it never causes overflow or layout shift.

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { EASE_OUT } from "@/lib/ease";
import { cn } from "@/lib/utils";

export function Tip({
  text,
  children,
  focusable = true,
  className,
}: {
  text: ReactNode;
  children: ReactNode;
  /** False when the tag sits inside a button (nested focus stops are invalid). */
  focusable?: boolean;
  className?: string;
}) {
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const reduce = useReducedMotion();

  const place = useCallback(() => {
    const t = ref.current?.getBoundingClientRect();
    const w = tipRef.current?.offsetWidth ?? 220;
    const h = tipRef.current?.offsetHeight ?? 60;
    if (!t) return;
    const left = Math.min(Math.max(8, t.left + t.width / 2 - w / 2), window.innerWidth - w - 8);
    const above = t.top - h - 8;
    setPos({ left, top: above >= 8 ? above : t.bottom + 8 });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place, text]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDoc = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("pointerdown", onDoc);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDoc);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span
      ref={ref}
      className={cn("inline-flex", className)}
      tabIndex={focusable ? 0 : undefined}
      aria-describedby={open ? id : undefined}
      onPointerEnter={(e) => e.pointerType === "mouse" && setOpen(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onClick={(e) => {
        // Touch: a tap shows the tip instead of whatever the tag sits in.
        if ((e.nativeEvent as PointerEvent).pointerType === "touch") {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }
      }}
    >
      {children}
      {typeof document === "undefined"
        ? null
        : createPortal(
            <AnimatePresence>
              {open ? (
                <motion.span
                  key="tip"
                  id={id}
                  role="tooltip"
                  ref={tipRef}
                  initial={{ opacity: 0, y: reduce ? 0 : 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.16, ease: EASE_OUT }}
                  className="tip"
                  style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
                >
                  {text}
                </motion.span>
              ) : null}
            </AnimatePresence>,
            document.body,
          )}
    </span>
  );
}
