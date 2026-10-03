"use client";
// Centered dialog (beUI `center-morph-modal` idea, re-skinned with Tally's glass recipe). Used for sign-in, top-up and review:
// centered on every screen size, never stuck to an edge. Scroll lock is `overflow: hidden` only (no `position: fixed` body),
// so releasing it never shifts the page and no shared-layout pill (the $/Shares and tolerance toggles) gets projected from a stale position.

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { EASE_OUT, SPRING_PANEL } from "@/lib/ease";
import { PresenceGate } from "@/lib/presence-gate";
import { cn } from "@/lib/utils";

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
  className?: string;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea,[tabindex]:not([tabindex="-1"])';

export function Modal({ open, onOpenChange, title, description, children, className }: ModalProps) {
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const uid = useId();
  // Parents re-render often (countdowns, polling): keep the latest callback in a ref so the effect below runs once per open.
  const changeRef = useRef(onOpenChange);
  changeRef.current = onOpenChange;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const prevOverflow = root.style.overflow;
    root.style.overflow = "hidden";
    const previouslyFocused = document.activeElement as HTMLElement | null;
    queueMicrotask(() => panelRef.current?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        changeRef.current(false);
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      );
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panelRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      root.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <PresenceGate key="modal">
          {({ gate }) => (
            <div
              className="fixed inset-0 z-50 grid place-items-center p-4"
              style={gate.style}
              inert={gate.inert}
            >
              <motion.button
                type="button"
                aria-label="Close"
                tabIndex={-1}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25, ease: EASE_OUT }}
                onClick={() => changeRef.current(false)}
                className="overlay-backdrop absolute inset-0"
              />
              <motion.div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={`${uid}-t`}
                aria-describedby={description ? `${uid}-d` : undefined}
                tabIndex={-1}
                initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 12 }}
                animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 8 }}
                transition={reduce ? { duration: 0.15 } : SPRING_PANEL}
                className={cn(
                  "glass relative z-10 flex max-h-[calc(100svh-32px)] w-full max-w-[520px] flex-col overflow-hidden outline-none",
                  "!bg-[var(--g2)]",
                  className,
                )}
              >
                <div className="px-5 pb-1 pt-5 min-[561px]:px-6 min-[561px]:pt-6">
                  <h2 id={`${uid}-t`} className="t-h3">
                    {title}
                  </h2>
                  {description ? (
                    <p id={`${uid}-d`} className="mt-0.5 text-sm text-fg2">
                      {description}
                    </p>
                  ) : null}
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 min-[561px]:px-6 min-[561px]:pb-6">
                  {children}
                </div>
              </motion.div>
            </div>
          )}
        </PresenceGate>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
