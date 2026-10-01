// Touch primitives (from BeUI). Opt a gesture surface out of iOS callout and long-press selection.

/** For a surface that is the control itself (handle, thumb). */
export const TOUCH_GESTURE_CLASS = "select-none [-webkit-touch-callout:none]";
/** For a gesture surface wrapping content the consumer owns; selection is suppressed on coarse pointers only. */
export const TOUCH_GESTURE_CONTENT_CLASS =
  "[-webkit-touch-callout:none] pointer-coarse:select-none";
