"use client";
// Adapted from beUI `bottom-sheet`. Glass surface per DESIGN.md §2.4; backdrop per the overlay recipe.

import {
  AnimatePresence,
  motion,
  type PanInfo,
  useDragControls,
  useReducedMotion,
} from "motion/react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { EASE_DRAWER } from "@/lib/ease";
import { PresenceGate } from "@/lib/presence-gate";
import { TOUCH_GESTURE_CONTENT_CLASS } from "@/lib/touch";
import { cn } from "@/lib/utils";

const DRAWER = { duration: 0.5, ease: EASE_DRAWER } as const;

export interface BottomSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Heights (0-1 = fraction of viewport, or "auto"). First entry is the default. */
  snapPoints?: (number | "auto")[];
  defaultSnap?: number;
  title?: string;
  description?: string;
  children?: ReactNode;
  className?: string;
  dismissThreshold?: number;
}

export function BottomSheet({
  open,
  onOpenChange,
  snapPoints = [0.5, 0.92],
  defaultSnap = 0,
  title,
  description,
  children,
  className,
  dismissThreshold = 120,
}: BottomSheetProps) {
  const [snap, setSnap] = useState(defaultSnap);
  const [mounted, setMounted] = useState(false);
  const dragControls = useDragControls();
  const sheetRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const uid = useId();
  const titleId = `${uid}-title`;
  const descriptionId = `${uid}-description`;

  // Parents pass inline callbacks and re-render often (a countdown, a polling balance). Keeping the latest in a ref means the
  // scroll lock, key handler and focus move below run once per open, not on every render (re-running stole focus each second).
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (open) setSnap(defaultSnap);
  }, [open, defaultSnap]);

  // Lock background scroll (position:fixed is the lock iOS Safari honours) and handle Esc.
  useEffect(() => {
    if (!open) return;
    const body = document.body;
    const scrollY = window.scrollY;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      overflow: body.style.overflow,
    };
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onOpenChangeRef.current(false);
        return;
      }
      // Focus trap (DESIGN §7): Tab cycles inside the dialog.
      if (event.key === "Tab" && sheetRef.current) {
        const items = Array.from(
          sheetRef.current.querySelectorAll<HTMLElement>(
            'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])',
          ),
        ).filter((el) => el.offsetParent !== null);
        if (items.length === 0) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        const active = document.activeElement;
        if (event.shiftKey && (active === first || active === sheetRef.current)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    // Move focus into the dialog (DESIGN.md §7).
    const previouslyFocused = document.activeElement as HTMLElement | null;
    queueMicrotask(() => sheetRef.current?.focus());
    return () => {
      window.removeEventListener("keydown", onKey);
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.left = prev.left;
      body.style.right = prev.right;
      body.style.overflow = prev.overflow;
      window.scrollTo(0, scrollY);
      previouslyFocused?.focus?.();
    };
  }, [open]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const velocity = info.velocity.y;
    const offset = info.offset.y;
    if (velocity > 600 || offset > dismissThreshold) {
      const smaller = snapPoints.map((_, i) => i).filter((i) => i < snap);
      if (smaller.length && velocity < 800 && offset < dismissThreshold * 1.6) {
        setSnap(smaller[smaller.length - 1]!);
      } else {
        onOpenChange(false);
      }
      return;
    }
    if (velocity < -500) {
      setSnap((c) => Math.min(snapPoints.length - 1, c + 1));
      return;
    }
    setSnap((c) => {
      if (offset > 80 && c > 0) return c - 1;
      if (offset < -80 && c < snapPoints.length - 1) return c + 1;
      return c;
    });
  };

  const snapValue = snapPoints[snap] ?? "auto";
  const heightStyle =
    snapValue === "auto" ? { maxHeight: "92vh" } : { height: `${snapValue * 100}vh` };

  // Portal to <body>: an ancestor with backdrop-filter would otherwise become the containing block.
  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <PresenceGate key="backdrop">
          {({ gate }) => (
            <motion.button
              type="button"
              aria-label="Close"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={DRAWER}
              {...gate}
              onClick={() => onOpenChange(false)}
              className="overlay-backdrop pointer-events-auto fixed inset-0 z-50"
            />
          )}
        </PresenceGate>
      ) : null}
      {open ? (
        <PresenceGate key="sheet">
          {({ gate }) => (
            <motion.div
              ref={sheetRef}
              tabIndex={-1}
              drag="y"
              dragControls={dragControls}
              dragListener={false}
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0.02, bottom: 0.4 }}
              dragMomentum={false}
              onDragEnd={onDragEnd}
              initial={reduce ? { y: 0, opacity: 0 } : { y: "100%" }}
              animate={reduce ? { y: 0, opacity: 1 } : { y: 0 }}
              exit={reduce ? { y: 0, opacity: 0 } : { y: "100%" }}
              transition={reduce ? { duration: 0.15, ease: EASE_DRAWER } : DRAWER}
              {...gate}
              style={{ ...heightStyle, ...gate.style }}
              className={cn(
                "glass pointer-events-auto !fixed bottom-0 left-0 right-0 z-50 mx-auto flex max-w-2xl flex-col overflow-hidden !rounded-b-none !rounded-t-[28px] outline-none will-change-transform",
                "!bg-[var(--g2)]",
                className,
              )}
              role="dialog"
              aria-modal="true"
              aria-labelledby={title ? titleId : undefined}
              aria-describedby={description ? descriptionId : undefined}
              aria-label={title ? undefined : "Dialog"}
            >
              <div className="flex flex-col items-center px-4 pb-2 pt-3">
                <div
                  onPointerDown={(e) => dragControls.start(e)}
                  className={cn(
                    "flex cursor-grab touch-none items-center justify-center py-1 active:cursor-grabbing",
                    TOUCH_GESTURE_CONTENT_CLASS,
                  )}
                >
                  <div className="h-1.5 w-10 rounded-full bg-white/25" />
                </div>
                {title || description ? (
                  <div className="mt-2 w-full">
                    {title ? (
                      <h2 id={titleId} className="t-h3">
                        {title}
                      </h2>
                    ) : null}
                    {description ? (
                      <p id={descriptionId} className="mt-0.5 text-sm text-fg2">
                        {description}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(24px,env(safe-area-inset-bottom))]">
                {children}
              </div>
            </motion.div>
          )}
        </PresenceGate>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
