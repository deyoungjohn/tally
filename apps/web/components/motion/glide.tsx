"use client";
// One highlight pill for a whole list (nav tabs, menu items, select options, segmented controls).
//
// How beUI's File Tree gets its smooth glide (components/motion/file-tree.tsx + shared-layout-bg.tsx): there is a single
// pill, not one background per item. The pill is shared across the items, so moving to another item moves the same
// element with a spring (SPRING_LAYOUT) instead of fading one box out and another in. When the pointer leaves the list
// the pill fades out (or, for a selected item, stays on it). Our first port of it used Motion's layoutId projection,
// which could start from a stale position when the list sat in a sticky or scrolled ancestor. This version keeps the same
// physics but measures the item's box against the list itself, so it cannot be thrown by scrolling, sticky headers or
// panels that are still animating open.
//
// Mark each item with `data-glide`. The item that is selected (`rest`) keeps the pill when nothing is hovered:
// by default the one with aria-current="page", aria-selected="true" or aria-checked="true".

import { useReducedMotion } from "motion/react";
import {
  type ElementType,
  type HTMLAttributes,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const REST_SELECTOR = '[aria-current="page"],[aria-selected="true"],[aria-checked="true"]';

export interface GlideProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  children: ReactNode;
  as?: ElementType;
  /** Class of the moving pill. */
  pillClassName?: string;
  /** Pill is shown on the selected item when nothing is hovered. Default true. */
  keepRest?: boolean;
  /** Hovering moves the pill. Default true (turn off for a plain selection indicator). */
  hover?: boolean;
  /** Pill extends this many px past each item on every side. */
  bleed?: number;
  pillStyle?: React.CSSProperties;
}

const same = (a: Box | null, b: Box | null) =>
  a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);

export function Glide({
  children,
  as: Tag = "div",
  className,
  pillClassName,
  keepRest = true,
  hover = true,
  bleed = 0,
  pillStyle,
  onPointerLeave,
  ...props
}: GlideProps) {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const [box, setBox] = useState<Box | null>(null);
  const hovered = useRef<HTMLElement | null>(null);
  const pill = useRef<HTMLSpanElement>(null);
  // The pill snaps (no travel) the first time it appears; every later move is a spring.
  const visible = useRef(false);

  // Measured from layout offsets (offsetLeft/Top/Width/Height), not getBoundingClientRect: a bounding box includes transforms, so items
  // that are still sliding in (a Select's staggered options) or sit in a scaling modal gave the pill the wrong spot. When the item
  // is not inside the list's offset chain the bounding box is the fallback.
  const measure = useCallback(
    (el: HTMLElement | null): Box | null => {
      const root = ref.current;
      if (!el || !root) return null;
      if (el.offsetWidth === 0 || el.offsetHeight === 0) return null;
      let x = 0;
      let y = 0;
      let node: HTMLElement | null = el;
      while (node && node !== root) {
        x += node.offsetLeft;
        y += node.offsetTop;
        node = node.offsetParent as HTMLElement | null;
      }
      if (node === root) {
        return {
          x: x - root.clientLeft - bleed,
          y: y - root.clientTop - bleed,
          w: el.offsetWidth + bleed * 2,
          h: el.offsetHeight + bleed * 2,
        };
      }
      const c = root.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      return {
        x: r.left - c.left - root.clientLeft - bleed,
        y: r.top - c.top - root.clientTop - bleed,
        w: r.width + bleed * 2,
        h: r.height + bleed * 2,
      };
    },
    [bleed],
  );

  const restEl = useCallback(
    () => (keepRest ? (ref.current?.querySelector<HTMLElement>(REST_SELECTOR) ?? null) : null),
    [keepRest],
  );

  const settle = useCallback(() => {
    const next = measure(hovered.current ?? restEl());
    setBox((cur) => (same(cur, next) ? cur : next));
  }, [measure, restEl]);

  // Re-measure after every render (the selected item changes with the route) and when the list resizes.
  useLayoutEffect(() => {
    settle();
  });
  useEffect(() => {
    const root = ref.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(settle);
    ro.observe(root);
    window.addEventListener("resize", settle);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", settle);
    };
  }, [settle]);

  const over = (target: EventTarget | null) => {
    if (!hover) return;
    const item = (target as HTMLElement | null)?.closest<HTMLElement>("[data-glide]");
    if (!item || !ref.current?.contains(item) || item.getAttribute("aria-disabled") === "true")
      return;
    if ((item as HTMLButtonElement).disabled) return;
    hovered.current = item;
    settle();
  };

  // Imperative on purpose: a hidden pill must not fly in from the corner, and a hiding one must stay where it was while it fades.
  // The move is a CSS transition, not a JS spring: the browser retargets it from the pill's current position on every new
  // hover (so fast pointer travel never restarts it from rest) and runs it on the compositor, so a busy page (live numbers
  // ticking, quotes re-rendering) cannot starve it into a visible snap.
  useLayoutEffect(() => {
    const el = pill.current;
    if (!el) return;
    const move =
      "transform 0.34s cubic-bezier(0.22, 1.25, 0.36, 1), width 0.34s cubic-bezier(0.22, 1.25, 0.36, 1), height 0.34s cubic-bezier(0.22, 1.25, 0.36, 1)";
    if (box) {
      const jump = !visible.current || reduce;
      el.style.transition = jump ? "none" : `${move}, opacity 0.16s`;
      el.style.width = `${box.w}px`;
      el.style.height = `${box.h}px`;
      el.style.transform = `translate(${box.x}px, ${box.y}px)`;
      if (jump) void el.offsetWidth; // commit the jump before the next change is allowed to animate
      el.style.transition = reduce ? "none" : `${move}, opacity 0.16s`;
      el.style.opacity = "1";
      visible.current = true;
    } else {
      el.style.transition = reduce ? "none" : "opacity 0.16s";
      el.style.opacity = "0";
      visible.current = false;
    }
  }, [box, reduce]);

  return (
    <Tag
      {...props}
      ref={ref}
      className={cn("relative isolate", className)}
      onPointerOver={(e: React.PointerEvent<HTMLElement>) => {
        if (e.pointerType !== "touch") over(e.target);
        props.onPointerOver?.(e);
      }}
      onFocus={(e: React.FocusEvent<HTMLElement>) => {
        over(e.target);
        props.onFocus?.(e);
      }}
      onBlur={(e: React.FocusEvent<HTMLElement>) => {
        if (!ref.current?.contains(e.relatedTarget as Node | null)) {
          hovered.current = null;
          settle();
        }
        props.onBlur?.(e);
      }}
      onPointerLeave={(e: React.PointerEvent<HTMLElement>) => {
        hovered.current = null;
        settle();
        onPointerLeave?.(e);
      }}
    >
      <span
        ref={pill}
        aria-hidden
        data-glide-pill
        style={{ opacity: 0, ...pillStyle }}
        className={cn(
          "pointer-events-none absolute left-0 top-0 -z-10 rounded-full bg-white/[0.09]",
          pillClassName,
        )}
      />
      {children}
    </Tag>
  );
}
