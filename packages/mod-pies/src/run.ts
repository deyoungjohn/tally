import type { PieRun } from "./types";

export function pieRunState(run: PieRun): "pending" | "partially rebalanced" | "complete" {
  if (run.legs.some((leg) => leg.status === "failed")) return "partially rebalanced";
  if (run.legs.every((leg) => leg.status === "done" || leg.status === "skipped")) return "complete";
  return "pending";
}

/** Terminal results are immutable. A failure records only this leg; no retry/scheduling side effects. */
export function applyLegResult(
  run: PieRun,
  legId: string,
  result: {
    status: "done" | "failed" | "skipped";
    txHash?: string;
    reason?: string;
  },
): PieRun {
  const leg = run.legs.find((leg) => leg.id === legId);
  if (!leg) throw new Error(`Unknown leg ${legId}`);
  if (leg.status !== "pending") throw new Error(`Leg ${legId} already has a terminal result`);
  if (result.status !== "done" && !result.reason?.trim())
    throw new Error("Failed/skipped leg needs a reason");
  return {
    ...run,
    legs: run.legs.map((leg) => (leg.id === legId ? { id: leg.id, ...result } : { ...leg })),
  };
}
