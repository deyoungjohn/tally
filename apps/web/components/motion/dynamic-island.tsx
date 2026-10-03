"use client";
// beUI `dynamic-island` (beui.dev/components/blocks/dynamic-island), re-skinned: a glass pill instead of the light default.

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { EASE_OUT } from "@/lib/ease";
import { cn } from "@/lib/utils";

const IslandContext = createContext<{ view: string | null } | null>(null);

const SHELL_SPRING = { type: "spring", duration: 0.8, bounce: 0.2 } as const;
const CONTENT_SPRING = { type: "spring", duration: 0.8, bounce: 0.35 } as const;
const RADIUS = 32;
const PILL_WIDTH = 126;
const PILL_HEIGHT = 37;

function useContentSize() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setSize({ width: el.offsetWidth, height: el.offsetHeight });
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() =>
      setSize({ width: el.offsetWidth, height: el.offsetHeight }),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

function Slot({
  keyId,
  children,
  className,
}: {
  keyId: string;
  children: ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      key={keyId}
      initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.9, y: -8, filter: "blur(5px)" }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
      exit={
        reduce
          ? { opacity: 0, transition: { duration: 0.1 } }
          : { opacity: 0, scale: 0.9, y: -6, transition: { duration: 0.08, ease: EASE_OUT } }
      }
      transition={reduce ? { duration: 0.15 } : CONTENT_SPRING}
      style={{ transformOrigin: "top center" }}
      className={cn("flex items-center justify-center", className)}
    >
      {children}
    </motion.div>
  );
}

export function DynamicIsland({
  view,
  compact,
  children,
  className,
  contentClassName,
}: {
  view: string | null;
  compact?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Sizing for the measured content box (a minimum width keeps the shell from collapsing around absolutely positioned views). */
  contentClassName?: string;
}) {
  const reduce = useReducedMotion();
  const expanded = view !== null;
  const [sizerRef, size] = useContentSize();
  // The shell must not grow out of the compact pill the first time it appears (that is where its content looked clipped): it snaps
  // to its measured size, and only later size changes (between views) are sprung.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!size || armed) return;
    const id = requestAnimationFrame(() => setArmed(true));
    return () => cancelAnimationFrame(id);
  }, [size, armed]);
  const ctx = useMemo(() => ({ view }), [view]);
  return (
    <IslandContext.Provider value={ctx}>
      <motion.div
        role="status"
        aria-live="polite"
        initial={false}
        animate={
          size
            ? { width: size.width, height: size.height }
            : { width: PILL_WIDTH, height: PILL_HEIGHT }
        }
        transition={reduce || !armed ? { duration: 0 } : SHELL_SPRING}
        style={{ borderRadius: RADIUS }}
        className={cn(
          "glass relative inline-flex max-w-full items-start justify-center overflow-hidden text-fg",
          className,
        )}
      >
        <div ref={sizerRef} className={cn("w-max max-w-full", contentClassName)}>
          <AnimatePresence mode="popLayout" initial={false}>
            {!expanded && compact ? (
              <Slot
                keyId="compact"
                className="min-h-[37px] min-w-[126px] gap-2 px-4 py-1.5 text-xs font-medium"
              >
                {compact}
              </Slot>
            ) : null}
          </AnimatePresence>
          {children}
        </div>
      </motion.div>
    </IslandContext.Provider>
  );
}

export function DynamicIslandView({
  id,
  children,
  className,
}: {
  id: string;
  children: ReactNode;
  className?: string;
}) {
  const ctx = useContext(IslandContext);
  if (!ctx) throw new Error("DynamicIslandView must be used inside <DynamicIsland>");
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      {ctx.view === id ? (
        <Slot keyId={id} className={cn("px-5 py-3", className)}>
          {children}
        </Slot>
      ) : null}
    </AnimatePresence>
  );
}
