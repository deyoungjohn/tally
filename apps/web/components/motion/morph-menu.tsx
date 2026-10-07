"use client";
// Desktop account menu. The panel is the trigger button, grown: it starts at the button's exact box and morphs down and
// out into the menu (beUI morphing-modal idea, anchored to the button instead of the screen edge). It lives in a portal
// and is position: fixed, so opening it never moves the header or the page; the page is not scroll-locked either, so there
// is no scrollbar shift. The backdrop is the same blurred glass as the other overlays.

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { EASE_OUT, SPRING_PANEL } from "@/lib/ease";
import { PresenceGate } from "@/lib/presence-gate";

interface Box {
  top: number;
  right: number;
  width: number;
  height: number;
}

const LIST: import("motion/react").Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.035, delayChildren: 0.12 } },
};
const ITEM: import("motion/react").Variants = {
  hidden: { opacity: 0, y: -6, filter: "blur(3px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)" },
};

export function MorphMenu({
  open,
  onClose,
  anchor,
  header,
  width = 264,
  rows,
  rowHeight = 44,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  anchor: RefObject<HTMLElement | null>;
  /** What the button shows; repeated at the top of the panel so it reads as the same object growing. */
  header: ReactNode;
  width?: number;
  /** Number of menu rows (the panel's height is computed from it so the morph has a fixed target). */
  rows: number;
  rowHeight?: number;
  label: string;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  const [box, setBox] = useState<Box | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => setMounted(true), []);

  // Measure the button when the menu opens (and keep following it if the window resizes).
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (r)
        setBox({
          top: r.top,
          right: Math.max(0, document.documentElement.clientWidth - r.right),
          width: r.width,
          height: r.height,
        });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open, anchor]);

  useEffect(() => {
    if (!open) return;
    const trigger = anchor.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key === "Tab" && panelRef.current) {
        const items = Array.from(
          panelRef.current.querySelectorAll<HTMLElement>("a[href],button:not([disabled])"),
        );
        if (items.length === 0) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    const t = window.setTimeout(
      () => panelRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus(),
      reduce ? 0 : 180,
    );
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(t);
      trigger?.focus?.({ preventScroll: true });
    };
  }, [open, anchor, reduce]);

  if (!mounted) return null;

  const headerH = box?.height ?? 40;
  const fullH = headerH + 8 + rows * rowHeight + (rows - 1) * 2 + 8;
  const shut = box ? { width: box.width, height: box.height, borderRadius: 9999 } : undefined;
  const wide = { width, height: fullH, borderRadius: 24 };

  return createPortal(
    <AnimatePresence>
      {open && box ? (
        <PresenceGate key="menu">
          {({ gate }) => (
            <div className="fixed inset-0 z-[80]" style={gate.style} inert={gate.inert}>
              <motion.button
                type="button"
                aria-label="Close menu"
                tabIndex={-1}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25, ease: EASE_OUT }}
                onClick={() => closeRef.current()}
                className="absolute inset-0 bg-[rgba(5,6,7,0.38)] [backdrop-filter:blur(14px)_saturate(140%)]"
              />
              <motion.div
                ref={panelRef}
                role="menu"
                aria-label={label}
                initial={reduce ? { opacity: 0, ...wide } : { ...shut, opacity: 0.9 }}
                animate={{ ...wide, opacity: 1 }}
                exit={
                  reduce
                    ? { opacity: 0 }
                    : { ...shut, opacity: 0, transition: { duration: 0.22, ease: EASE_OUT } }
                }
                transition={reduce ? { duration: 0.15 } : SPRING_PANEL}
                style={{ top: box.top, right: box.right, transformOrigin: "top right" }}
                className="glass glass-pop !fixed overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => closeRef.current()}
                  className="flex w-full items-center justify-between gap-2 px-4 text-left text-fg"
                  style={{ height: headerH }}
                  aria-label="Close menu"
                  tabIndex={-1}
                >
                  {header}
                </button>
                <motion.div
                  variants={reduce ? undefined : LIST}
                  initial="hidden"
                  animate="show"
                  className="grid gap-[2px] px-2 pt-2"
                  style={{ width }}
                >
                  {children}
                </motion.div>
              </motion.div>
            </div>
          )}
        </PresenceGate>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

/** One menu row. Wrap link or button content in it so the rows stagger in. */
export function MorphItem({ children }: { children: ReactNode }) {
  return <motion.div variants={ITEM}>{children}</motion.div>;
}
