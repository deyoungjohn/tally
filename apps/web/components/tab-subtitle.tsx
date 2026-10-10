"use client";
// The line under a page title that changes with the tab below it. Every version sits in the same grid cell, so the block is as tall as
// the longest and nothing below it moves; only the one for the active tab is visible, and the change is a short fade with a blur.

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function TabSubtitle<K extends string>({
  items,
  active,
  className,
}: {
  items: Record<K, ReactNode>;
  active: K;
  className?: string;
}) {
  return (
    <div className={cn("grid", className)} data-testid="tab-subtitle" data-active={active}>
      {(Object.keys(items) as K[]).map((k) => (
        <p
          key={k}
          className={cn(
            "t-lead col-start-1 row-start-1 max-w-[62ch] transition-[opacity,filter] duration-500 motion-reduce:transition-none",
            k === active ? "opacity-100 blur-0" : "pointer-events-none opacity-0 blur-[6px]",
          )}
          aria-hidden={k !== active}
          data-testid={`tab-subtitle-${k}`}
        >
          {items[k]}
        </p>
      ))}
    </div>
  );
}
