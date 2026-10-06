"use client";

import { useEffect, useState } from "react";
import type { ModuleName } from "@tally/config";

/**
 * Which feature flags the server has on, read from /api/modules/health (environment values never reach the browser).
 * Everything is off until the answer arrives and when the request fails, so a flagged feature never flashes in.
 */
export function useModuleFlags(): Partial<Record<ModuleName, boolean>> {
  const [flags, setFlags] = useState<Partial<Record<ModuleName, boolean>>>({});
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/modules/health", { signal: controller.signal, cache: "no-store" })
      .then(async (r) => {
        const data = (await r.json()) as { flags?: Partial<Record<ModuleName, unknown>> };
        setFlags(
          Object.fromEntries(
            Object.entries(data.flags ?? {}).map(([k, v]) => [k, v === true]),
          ) as Partial<Record<ModuleName, boolean>>,
        );
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  return flags;
}

/** Same read as `useModuleFlags`, but also says whether the answer has arrived, so a screen can wait instead of flashing the wrong version. */
export function useModuleFlagsState(): {
  flags: Partial<Record<ModuleName, boolean>>;
  ready: boolean;
} {
  const [state, setState] = useState<{
    flags: Partial<Record<ModuleName, boolean>>;
    ready: boolean;
  }>({ flags: {}, ready: false });
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/modules/health", { signal: controller.signal, cache: "no-store" })
      .then(async (r) => {
        const data = (await r.json()) as { flags?: Partial<Record<ModuleName, unknown>> };
        setState({
          flags: Object.fromEntries(
            Object.entries(data.flags ?? {}).map(([k, v]) => [k, v === true]),
          ) as Partial<Record<ModuleName, boolean>>,
          ready: true,
        });
      })
      .catch(() => {
        // The request failed: treat every flag as off, and stop waiting.
        if (!controller.signal.aborted) setState({ flags: {}, ready: true });
      });
    return () => controller.abort();
  }, []);
  return state;
}
