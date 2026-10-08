// Pointer-capture helpers the table's resize and reorder handles use (from beUI's touch utilities).

/** Capture a pointer on `element`; a pointer that is no longer active is ignored. */
export function capturePointer(element: Element, pointerId: number) {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // Pointer is no longer active: implicit capture still applies on touch.
  }
}

/** Release a capture taken with `capturePointer`, ignoring a stale pointer. */
export function releasePointer(element: Element, pointerId: number) {
  try {
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
  } catch {
    // Capture was already dropped by the browser.
  }
}

/** Stops text selection while a header is being dragged. */
export const TOUCH_GESTURE_CLASS = "select-none [-webkit-touch-callout:none]";
