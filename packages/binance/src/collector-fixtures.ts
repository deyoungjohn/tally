import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { latestRaw } from "./fixtures";

const PROBES = join(dirname(fileURLToPath(import.meta.url)), "../../../spike/results");
interface Recording {
  _meta?: { finishedAt?: string };
  [key: string]: unknown;
}
interface Probe {
  ok: boolean;
  data?: unknown;
}

/** Find the newest successful recording of each call, not just the newest file. */
export function collectorRecording(key: string): {
  data: unknown;
  observedAt: number;
  source: string;
} {
  for (const file of readdirSync(PROBES)
    .filter((f) => /^module_probes_.*\.json$/.test(f))
    .sort()
    .reverse()) {
    const recording = JSON.parse(readFileSync(join(PROBES, file), "utf8")) as Recording;
    const probe = recording[key] as Probe | undefined;
    if (!probe?.ok || probe.data === undefined) continue;
    const observedAt = Date.parse(recording._meta?.finishedAt ?? "");
    if (!Number.isFinite(observedAt)) throw new Error(`Fixture ${file} has no observation time`);
    return { data: probe.data, observedAt, source: `fixture:${file}:${key}` };
  }
  throw new Error(`No successful collector recording for ${key}`);
}

/** Separate adapter: legacy quote fixtures remain unchanged. Unrecorded prices fail explicitly. */
export function createCollectorFixtureFetch(fallback: typeof fetch): typeof fetch {
  return async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    const path = url.pathname;
    let data: unknown;
    if (path.endsWith("/market/rwa/tokens") && url.searchParams.has("binanceChainId")) {
      data = collectorRecording(
        url.searchParams.get("platformId") === "bstock"
          ? "G_rwa_tokens_bstock"
          : "G_rwa_tokens_earnings",
      ).data;
      if (url.searchParams.get("platformId") === "ondo") {
        data = (data as { platformId: string }[]).filter((row) => row.platformId === "ondo");
      }
    } else if (path.endsWith("/market/rwa/price")) {
      const recorded = collectorRecording("P_rwa_price_batch").data as {
        tokenContractAddress: string;
      }[];
      const addresses = (url.searchParams.get("tokenContractAddresses") ?? "").split(",");
      data = recorded.filter((r) =>
        addresses.some((a) => a.toLowerCase() === r.tokenContractAddress.toLowerCase()),
      );
      // Missing entries stay missing: the worker records a reason rather than fabricating prices.
    } else if (path.endsWith("/market/portfolio/recent-pnl")) {
      data = collectorRecording("X_recent_pnl").data;
    } else if (path.endsWith("/market/portfolio/dex-history")) {
      data = collectorRecording("X_dex_history").data;
    } else if (path.endsWith("/market/portfolio/overview")) {
      data = collectorRecording("X_portfolio_overview_tf").data;
    } else if (path.endsWith("/market/portfolio/token/latest-pnl")) {
      data = collectorRecording("X_token_pnl").data;
    } else return fallback(input, init);
    return new Response(JSON.stringify({ code: 0, msg: "fixture", data }), {
      headers: { "content-type": "application/json" },
    });
  };
}

/** Evidence used to verify the additive list schema against the pre-existing Seoul fixture. */
export function recordedLegacyRwaList(): unknown {
  const recording = JSON.parse(readFileSync(latestRaw("rwa_authenticated_probes"), "utf8")) as {
    rwa_tokens: Probe;
  };
  return recording.rwa_tokens.data;
}
