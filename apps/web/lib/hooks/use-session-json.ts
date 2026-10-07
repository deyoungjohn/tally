"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSessionFetch } from "./use-session-fetch";

export type SessionJson<T> =
  | { status: "signed-out" }
  | { status: "loading"; data: T | null }
  | { status: "ok"; data: T }
  /** The server did not accept the sign-in (401), or no token could be read. */
  | { status: "unverified"; data: T | null }
  | { status: "error"; data: T | null; message: string };

/** Fetch session-verified JSON for the signed-in wallet; refetches on `reload`, when the wallet changes, and every `refreshMs`. */
export function useSessionJson<T>(url: string, opts: { refreshMs?: number } = {}) {
  const { sessionFetch, signedIn, address } = useSessionFetch();
  const [state, setState] = useState<SessionJson<T>>({ status: "loading", data: null });
  const [n, setN] = useState(0);
  const last = useRef<T | null>(null);

  useEffect(() => {
    if (!signedIn) {
      last.current = null;
      setState({ status: "signed-out" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading", data: last.current });
    void (async () => {
      let res: Response | null = null;
      try {
        res = await sessionFetch(url);
      } catch {
        if (!cancelled)
          setState({ status: "error", data: last.current, message: "Couldn't reach Tally." });
        return;
      }
      if (cancelled) return;
      if (res === null || res.status === 401) {
        setState({ status: "unverified", data: last.current });
        return;
      }
      if (!res.ok) {
        setState({ status: "error", data: last.current, message: "Couldn't load this right now." });
        return;
      }
      try {
        const data = (await res.json()) as T;
        last.current = data;
        if (!cancelled) setState({ status: "ok", data });
      } catch {
        if (!cancelled)
          setState({ status: "error", data: last.current, message: "Couldn't read the answer." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, signedIn, address, n, sessionFetch]);

  useEffect(() => {
    if (!signedIn || !opts.refreshMs) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") setN((x) => x + 1);
    }, opts.refreshMs);
    return () => window.clearInterval(id);
  }, [signedIn, opts.refreshMs]);

  const reload = useCallback(() => setN((x) => x + 1), []);
  return { state, reload };
}
