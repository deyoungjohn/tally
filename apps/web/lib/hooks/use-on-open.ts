"use client";

import { useState } from "react";

/**
 * Runs `start` during the render in which `open` becomes true (beUI `use-on-open`).
 * `start` may only set state belonging to the calling component; anything reaching outside it belongs in an effect keyed to `open`.
 */
export function useOnOpen(open: boolean, start: () => void) {
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) start();
  }
}
