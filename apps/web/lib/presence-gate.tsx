"use client";

import { useIsPresent } from "motion/react";
import type { ReactNode } from "react";

export interface PresenceGateRenderProps {
  isPresent: boolean;
  /** Spread onto every layer that takes pointer events while the overlay is open. */
  gate: { inert: boolean; style: { pointerEvents: "auto" | "none" } };
}

/** Reads presence inside an AnimatePresence subtree so exiting overlays stop taking input (from BeUI). */
export function PresenceGate({
  children,
}: {
  children: (props: PresenceGateRenderProps) => ReactNode;
}) {
  const isPresent = useIsPresent();
  return children({
    isPresent,
    gate: { inert: !isPresent, style: { pointerEvents: isPresent ? "auto" : "none" } },
  });
}
