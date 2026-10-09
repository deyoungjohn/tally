import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { resetJsonCache, useJson } from "./use-json";

// Setup minimal DOM for React 19 testing in Node
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
class HTMLElement {}
class HTMLIFrameElement extends HTMLElement {}
(globalThis as unknown as { HTMLElement: unknown }).HTMLElement = HTMLElement;
(globalThis as unknown as { HTMLIFrameElement: unknown }).HTMLIFrameElement = HTMLIFrameElement;

function createMockContainer() {
  const style = {};
  const mockEl: unknown = {
    nodeType: 1,
    tagName: "DIV",
    style,
    ownerDocument: null,
    firstChild: null,
    lastChild: null,
    childNodes: [],
    removeChild: () => {},
    appendChild: () => {},
    insertBefore: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    setAttribute: () => {},
    removeAttribute: () => {},
  };
  const mockDoc = {
    nodeType: 9,
    defaultView: globalThis,
    createElement: () => mockEl,
    createElementNS: () => mockEl,
    createTextNode: (t: string) => ({ nodeType: 3, textContent: t }),
    createComment: () => ({ nodeType: 8 }),
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  (mockEl as { ownerDocument: unknown }).ownerDocument = mockDoc;
  return { mockEl, mockDoc };
}

describe("useJson (WO-01 wallet cache reset)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    const { mockDoc } = createMockContainer();
    (globalThis as unknown as { window: unknown }).window = globalThis;
    (globalThis as unknown as { document: unknown }).document = mockDoc;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("clears cached data immediately when URL changes so old address balances never show", async () => {
    let currentUrl: string | null = "/api/portfolio?address=0x111111";
    let hookState: ReturnType<typeof useJson<{ balance: number }>> = null!;

    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("0x111111")) {
        return { ok: true, json: async () => ({ balance: 100 }) };
      }
      if (url.includes("0x222222")) {
        // Delayed response to observe loading state
        await new Promise((r) => setTimeout(r, 20));
        return { ok: true, json: async () => ({ balance: 500 }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    const { mockEl, mockDoc } = createMockContainer();
    (globalThis as unknown as { document: unknown }).document = mockDoc;
    const root = createRoot(mockEl as unknown as Parameters<typeof createRoot>[0]);

    function TestComp() {
      hookState = useJson<{ balance: number }>(currentUrl);
      return null;
    }

    await act(async () => {
      root.render(createElement(TestComp));
    });

    // Initial fetch finished
    expect(hookState.data).toEqual({ balance: 100 });

    // Switch URL to address 0x222222
    currentUrl = "/api/portfolio?address=0x222222";
    await act(async () => {
      root.render(createElement(TestComp));
    });

    // Crucial check: data MUST be null while loading new URL, not displaying 0x111111's balance
    expect(hookState.data).toBeNull();
    expect(hookState.loading).toBe(true);

    // Let the second fetch complete
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

    expect(hookState.data).toEqual({ balance: 500 });

    act(() => root.unmount());
  });

  it("resets cached data and refetches when resetJsonCache() is called", async () => {
    let fetchCount = 0;
    let hookState: ReturnType<typeof useJson<{ count: number }>> = null!;

    globalThis.fetch = vi.fn().mockImplementation(async () => {
      fetchCount++;
      return { ok: true, json: async () => ({ count: fetchCount }) };
    });

    const { mockEl, mockDoc } = createMockContainer();
    (globalThis as unknown as { document: unknown }).document = mockDoc;
    const root = createRoot(mockEl as unknown as Parameters<typeof createRoot>[0]);

    function TestComp() {
      hookState = useJson<{ count: number }>("/api/radar");
      return null;
    }

    await act(async () => {
      root.render(createElement(TestComp));
    });

    expect(hookState.data).toEqual({ count: 1 });

    // Trigger global cache reset (simulating user sign-out or account change)
    await act(async () => {
      resetJsonCache();
    });

    // Data was cleared and new fetch occurred
    expect(hookState.data).toEqual({ count: 2 });
    expect(fetchCount).toBe(2);

    act(() => root.unmount());
  });

  it("a timed refresh never aborts a request that is still running (slow endpoint, short interval)", async () => {
    vi.useFakeTimers();
    try {
      let started = 0;
      let aborted = 0;
      let hookState: ReturnType<typeof useJson<{ ok: boolean }>> = null!;
      globalThis.fetch = vi
        .fn()
        .mockImplementation((_url: string, init: { signal: AbortSignal }) => {
          started++;
          return new Promise((resolve, reject) => {
            init.signal.addEventListener("abort", () => {
              aborted++;
              reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
            });
            // The endpoint needs 25 s; the page refreshes every 10 s.
            setTimeout(() => resolve({ ok: true, json: async () => ({ ok: true }) }), 25_000);
          });
        });
      const { mockEl, mockDoc } = createMockContainer();
      (globalThis as unknown as { document: unknown }).document = {
        ...mockDoc,
        visibilityState: "visible",
      };
      const root = createRoot(mockEl as unknown as Parameters<typeof createRoot>[0]);
      function TestComp() {
        hookState = useJson<{ ok: boolean }>("/api/portfolio?address=0x1", { refreshMs: 10_000 });
        return null;
      }
      await act(async () => {
        root.render(createElement(TestComp));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(26_000);
      });
      expect(aborted).toBe(0);
      expect(started).toBe(1);
      expect(hookState.data).toEqual({ ok: true });
      // Once it has finished, the next tick refreshes again.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(started).toBe(2);
      act(() => root.unmount());
    } finally {
      vi.useRealTimers();
    }
  });
});
