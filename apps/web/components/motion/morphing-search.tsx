"use client";
// Adapted from beUI `morphing-search` (beui.dev/components/blocks/morphing-search): a search field that morphs into a results surface.
// Tally changes: the query is controlled by the page (typing filters the page live and survives closing), an empty field shows
// suggestions, there is no page blur (the surface itself is glass), and the surface width is hard-capped on every screen size.

import { type LucideIcon, Search, X } from "lucide-react";
import {
  AnimatePresence,
  LayoutGroup,
  motion,
  type Transition,
  useReducedMotion,
} from "motion/react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { EASE_OUT, SPRING_LAYOUT } from "@/lib/ease";
import { useRowCursor } from "@/lib/hooks/use-row-cursor";
import { cn } from "@/lib/utils";

const SEARCH_MORPH: Transition = { type: "spring", duration: 0.58, bounce: 0.22 };
const SEARCH_CLIP_TRANSITION: Transition = { duration: 0.32, ease: EASE_OUT };

/** The surface is never wider than this, on any screen (the field it grows from can be wider or narrower). */
const MAX_PANEL_WIDTH = 380;
const EDGE = 12;

export type MorphingSearchItem = {
  id: string;
  title: string;
  description?: string;
  keywords?: string[];
  icon?: LucideIcon;
  /** The text put in the field when this suggestion is chosen. */
  value?: string;
};

export interface MorphingSearchProps {
  /** Everything that can be suggested. */
  items: MorphingSearchItem[];
  /** The current query. Typing calls `onValueChange` on every key so the page can filter live. */
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  shortcut?: string;
  emptyMessage?: string;
  /** How many suggestions show while the field is empty. */
  suggestionCount?: number;
  className?: string;
}

type AnchorRect = { top: number; left: number; width: number };

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

export function MorphingSearch({
  items,
  value,
  onValueChange,
  placeholder = "Search",
  shortcut = "/",
  emptyMessage = "No results found.",
  suggestionCount = 6,
  className,
}: MorphingSearchProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [locked, setLocked] = useState(false);
  const [anchorRect, setAnchorRect] = useState<AnchorRect>({ top: 16, left: 16, width: 288 });
  const reduce = useReducedMotion();
  const uid = useId();
  const anchorRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(open);
  const transition: Transition = reduce ? { duration: 0 } : SPRING_LAYOUT;
  const morphTransition: Transition = reduce ? { duration: 0 } : SEARCH_MORPH;

  const measureAnchor = useCallback(() => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    setAnchorRect({ top: rect.top, left: rect.left, width: rect.width });
  }, []);

  const openSearch = useCallback(() => {
    measureAnchor();
    setLocked(true);
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
  }, [measureAnchor]);

  const closeSearch = useCallback(() => setOpen(false), []);

  const shown = useMemo(() => {
    const needle = value.trim().toLowerCase();
    if (!needle) return items.slice(0, suggestionCount);
    return items.filter((item) =>
      [item.title, item.description ?? "", ...(item.keywords ?? [])]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [items, value, suggestionCount]);

  const { activeIndex, moveTo, moveActive } = useRowCursor(shown, value);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    measureAnchor();
    const anchor = anchorRef.current;
    const observer =
      anchor && typeof ResizeObserver !== "undefined" ? new ResizeObserver(measureAnchor) : null;
    if (anchor) observer?.observe(anchor);
    window.addEventListener("resize", measureAnchor);
    document.addEventListener("scroll", measureAnchor, true);
    window.visualViewport?.addEventListener("resize", measureAnchor);
    window.visualViewport?.addEventListener("scroll", measureAnchor);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measureAnchor);
      document.removeEventListener("scroll", measureAnchor, true);
      window.visualViewport?.removeEventListener("resize", measureAnchor);
      window.visualViewport?.removeEventListener("scroll", measureAnchor);
    };
  }, [measureAnchor]);

  // While open, the page behind does not scroll (only the results list does).
  useEffect(() => {
    if (!locked) return;
    const stop = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && listRef.current?.contains(target)) return;
      event.preventDefault();
    };
    document.addEventListener("wheel", stop, { passive: false });
    document.addEventListener("touchmove", stop, { passive: false });
    return () => {
      document.removeEventListener("wheel", stop);
      document.removeEventListener("touchmove", stop);
    };
  }, [locked]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && open) {
        event.preventDefault();
        closeSearch();
        return;
      }
      if (
        !open &&
        shortcut &&
        event.key.toLowerCase() === shortcut.toLowerCase() &&
        !event.repeat &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        !isEditableTarget(event.target)
      ) {
        event.preventDefault();
        openSearch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeSearch, open, openSearch, shortcut]);

  useEffect(() => {
    if (open) {
      const frame = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(frame);
    }
    if (wasOpenRef.current) {
      const frame = requestAnimationFrame(() => {
        const previous = previousFocusRef.current;
        (previous?.isConnected ? previous : triggerRef.current)?.focus();
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [open]);
  useEffect(() => {
    wasOpenRef.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  const choose = useCallback(
    (item: MorphingSearchItem) => {
      onValueChange(item.value ?? item.title);
      closeSearch();
    },
    [closeSearch, onValueChange],
  );

  const onDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActive(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(-1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      // Typed text already filters the page live. Enter either takes the highlighted suggestion or just closes.
      const item = value.trim() ? undefined : shown[activeIndex];
      if (item) choose(item);
      else closeSearch();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(
        'input, button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const shellLayoutId = `${uid}-shell`;
  const listboxId = `${uid}-results`;
  const vw = mounted ? window.innerWidth : 360;
  const panelWidth = Math.min(MAX_PANEL_WIDTH, vw - EDGE * 2);
  // Grows from the field's left edge, but never past the right edge of the screen.
  const panelLeft = Math.max(EDGE, Math.min(anchorRect.left, vw - panelWidth - EDGE));
  const growsWider = Math.max(0, panelWidth - anchorRect.width);
  const resultsHeight = mounted
    ? Math.max(120, Math.min(300, window.innerHeight - anchorRect.top - 80))
    : 288;
  const collapsedClip = `inset(0px ${growsWider}px ${resultsHeight}px 0px round 12px)`;
  const expandedClip = "inset(0px 0px 0px 0px round 12px)";

  const overlay = mounted
    ? createPortal(
        <div
          aria-hidden={!open}
          inert={!open}
          className="pointer-events-none fixed left-0 top-0 z-[70] size-0"
        >
          <AnimatePresence initial={false} mode="popLayout" onExitComplete={() => setLocked(false)}>
            {open ? (
              <motion.div key="morphing-search-overlay" className="fixed left-0 top-0 size-0">
                {/* A transparent catcher: a tap outside closes the search. No blur on the page. */}
                <button
                  type="button"
                  aria-label="Close search"
                  className="pointer-events-auto fixed inset-0 cursor-default bg-transparent"
                  onClick={closeSearch}
                />
                <motion.div
                  layoutId={shellLayoutId}
                  aria-hidden="true"
                  className="glass-solid fixed z-10 rounded-xl"
                  style={{
                    top: anchorRect.top,
                    left: panelLeft,
                    width: panelWidth,
                    height: 48 + resultsHeight,
                  }}
                  transition={morphTransition}
                />
                <motion.div
                  ref={dialogRef}
                  role="dialog"
                  aria-modal="true"
                  aria-label="Search"
                  onKeyDown={onDialogKeyDown}
                  initial={reduce ? false : { opacity: 0, clipPath: collapsedClip }}
                  animate={{ opacity: 1, clipPath: expandedClip }}
                  exit={{
                    opacity: 0,
                    clipPath: collapsedClip,
                    transition: reduce
                      ? { duration: 0 }
                      : { clipPath: SEARCH_CLIP_TRANSITION, opacity: SEARCH_MORPH },
                  }}
                  transition={
                    reduce
                      ? { duration: 0 }
                      : { clipPath: SEARCH_CLIP_TRANSITION, opacity: SEARCH_MORPH }
                  }
                  className="pointer-events-auto fixed z-20 overflow-hidden rounded-xl"
                  style={{ top: anchorRect.top, left: panelLeft, width: panelWidth }}
                >
                  <div className="flex h-12 items-center gap-2.5 border-b border-[var(--edge)] px-3.5">
                    <Search size={16} aria-hidden className="shrink-0 text-fg3" />
                    <div className="flex h-10 min-w-0 flex-1 items-center">
                      <input
                        ref={inputRef}
                        value={value}
                        onChange={(event) => onValueChange(event.target.value)}
                        role="combobox"
                        aria-label={placeholder}
                        aria-expanded="true"
                        aria-controls={listboxId}
                        aria-autocomplete="list"
                        aria-activedescendant={
                          shown.length > 0 ? `${uid}-option-${activeIndex}` : undefined
                        }
                        placeholder={placeholder}
                        autoComplete="off"
                        spellCheck={false}
                        data-testid="radar-search-input"
                        className="size-full bg-transparent text-[15px] text-fg outline-none placeholder:text-fg3 focus-visible:!shadow-none"
                      />
                    </div>
                    <kbd className="flex h-7 shrink-0 items-center rounded-md border border-[var(--edge)] px-2 text-xs text-fg3">
                      Esc
                    </kbd>
                  </div>

                  <motion.div
                    ref={listRef}
                    id={listboxId}
                    role="listbox"
                    aria-label="Search results"
                    variants={
                      reduce
                        ? undefined
                        : {
                            closed: {
                              opacity: 0,
                              transform: "translateY(6px)",
                              transition: { duration: 0.16, delay: 0.18, ease: EASE_OUT },
                            },
                            open: {
                              opacity: 1,
                              transform: "translateY(0px)",
                              transition: { duration: 0.16, ease: EASE_OUT },
                            },
                          }
                    }
                    initial={reduce ? { opacity: 1 } : "closed"}
                    animate={reduce ? { opacity: 1 } : "open"}
                    exit={reduce ? undefined : "closed"}
                    className="overflow-y-auto overscroll-contain p-2"
                    style={{ maxHeight: resultsHeight }}
                  >
                    <p className="px-3 pb-1 pt-1 text-[12.5px] font-semibold uppercase tracking-[0.1em] text-fg3">
                      {value.trim() ? "Results" : "Suggestions"}
                    </p>
                    {shown.length > 0 ? (
                      shown.map((item, index) => {
                        const Icon = item.icon;
                        const active = index === activeIndex;
                        return (
                          <button
                            key={item.id}
                            id={`${uid}-option-${index}`}
                            type="button"
                            role="option"
                            aria-selected={active}
                            data-index={index}
                            onMouseMove={() => moveTo(item.id)}
                            onFocus={() => moveTo(item.id)}
                            onClick={() => choose(item)}
                            className="relative flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                          >
                            {active ? (
                              <motion.span
                                layoutId={`${uid}-active-result`}
                                className="absolute inset-0 rounded-lg bg-[var(--hl)]"
                                transition={transition}
                              />
                            ) : null}
                            {Icon ? (
                              <Icon className="relative size-4 shrink-0 text-fg3" aria-hidden />
                            ) : null}
                            <span className="relative min-w-0">
                              <span className="block truncate text-[15px] font-semibold text-fg">
                                {item.title}
                              </span>
                              {item.description ? (
                                <span className="block truncate text-[13.5px] text-fg3">
                                  {item.description}
                                </span>
                              ) : null}
                            </span>
                          </button>
                        );
                      })
                    ) : (
                      <p className="px-3 py-8 text-center text-[15px] text-fg3">{emptyMessage}</p>
                    )}
                  </motion.div>
                </motion.div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>,
        document.body,
      )
    : null;

  return (
    <LayoutGroup id={uid}>
      <div ref={anchorRef} className={cn("relative h-12 w-full", className)}>
        {!open ? (
          <motion.button
            ref={triggerRef}
            key="morphing-search-trigger"
            layoutId={shellLayoutId}
            type="button"
            aria-haspopup="dialog"
            aria-expanded="false"
            aria-label={placeholder}
            onClick={openSearch}
            transition={morphTransition}
            data-testid="radar-search"
            className="glass-solid flex size-full cursor-text items-center rounded-xl px-3.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        ) : null}
        <motion.div
          aria-hidden="true"
          initial={false}
          animate={{ opacity: open ? 0 : 1 }}
          transition={
            reduce ? { duration: 0 } : { duration: 0.1, delay: open ? 0.1 : 0.12, ease: EASE_OUT }
          }
          className="pointer-events-none absolute inset-0 flex items-center gap-2.5 px-3.5"
        >
          <Search size={16} className="shrink-0 text-fg3" />
          <span
            className={cn("min-w-0 flex-1 truncate text-[15px]", value ? "text-fg" : "text-fg3")}
          >
            {value || placeholder}
          </span>
          {!value && shortcut ? (
            <kbd className="flex h-7 min-w-7 shrink-0 items-center justify-center rounded-md border border-[var(--edge)] px-2 text-xs text-fg3">
              {shortcut.toUpperCase()}
            </kbd>
          ) : null}
        </motion.div>
        {value && !open ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => onValueChange("")}
            className="absolute right-2 top-1/2 z-10 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-fg2 hover:bg-[var(--hl)] hover:text-fg"
          >
            <X size={15} aria-hidden />
          </button>
        ) : null}
      </div>
      {overlay}
    </LayoutGroup>
  );
}
