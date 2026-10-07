"use client";
import { useState } from "react";
import { useSessionFetch } from "@/lib/hooks/use-session-fetch";
import { AutopilotContent } from "./content";
import type { AutopilotVM } from "./view-model";

/** Optional plain session loader for the UI agent; address alone never grants edit access. */
export function AutopilotSessionPanel() {
  const { sessionFetch, signedIn, address } = useSessionFetch();
  const [loaded, setLoaded] = useState<{ wallet: string; vm: AutopilotVM } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const visible = signedIn && address?.toLowerCase() === loaded?.wallet ? loaded : null;
  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      const response = await sessionFetch("/api/session/autopilot/policy");
      if (!response?.ok) {
        setError("Verified shadow observations could not be loaded.");
        return;
      }
      const data: { walletAddress: string; viewModel: AutopilotVM } = await response.json();
      setLoaded({ wallet: data.walletAddress.toLowerCase(), vm: data.viewModel });
    } catch {
      console.warn("Autopilot session panel request failed; details withheld");
      setError("Verified shadow observations could not be loaded.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Verified-session shadow observations">
      <h2>Verified-session shadow observations</h2>
      <p>
        This section loads stored observations for your verified wallet. The preview above uses
        constructed data.
      </p>
      {!signedIn && <p>Sign in to load your shadow policy and observations.</p>}
      <button disabled={!signedIn || busy} onClick={refresh}>
        {busy ? "Loading…" : "Load verified shadow observations"}
      </button>
      {error && <p role="alert">{error}</p>}
      {visible && <AutopilotContent key={visible.wallet} vm={visible.vm} />}
    </section>
  );
}
