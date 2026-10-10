"use client";
// Execution quality from the receipts module's `QualityVM`: how fills compare with quotes, by issuer and by route length.
// Statistics use verified comparisons only; pending attempts and browser-reported comparisons are counted and excluded.
// The page shows the server's first answer, then polls /api/vm/quality so new fills appear without a reload.

import { useMemo } from "react";
import { Table, type TableColumn } from "@/components/motion/table";
import { Tip } from "@/components/ui/tooltip";
import type { QualityRow } from "@tally/mod-receipts";
import type { QualityVM } from "@/modules/quality/view-model";
import { ISSUER_LABEL } from "@/lib/format";
import { useJson } from "@/lib/hooks/use-json";
import { VmEmpty, VmFreshness, type VmEnvelope } from "@/components/portfolio/vm-shared";

export const QUALITY_POLL_MS = 5_000;
const pct = (v: number | null) => (v === null ? "-" : `${(v * 100).toFixed(1)}%`);
const bps = (v: number | null) => (v === null ? "-" : `${v > 0 ? "+" : ""}${v} bps`);

type Line = { id: string; label: string; row: QualityRow };

const NOT_ENOUGH = <span className="text-fg3">Not enough data</span>;
const cell = (row: QualityRow, f: (r: QualityRow) => string) =>
  row.insufficient ? NOT_ENOUGH : f(row);

export function QualityView({ vm: initial, fixtures }: { vm: QualityVM; fixtures: boolean }) {
  const live = useJson<VmEnvelope<QualityVM>>("/api/vm/quality", { refreshMs: QUALITY_POLL_MS });
  const vm = live.data?.vm ?? initial;
  const lines = useMemo<Line[]>(
    () => [
      ...vm.report.byIssuer.map((row) => ({
        id: `issuer:${row.issuer}`,
        label: ISSUER_LABEL[row.issuer] ?? row.issuer,
        row,
      })),
      ...vm.report.byRouteLength.map((row) => ({
        id: `hops:${row.routeLength ?? "unknown"}`,
        label:
          row.routeLength === null
            ? "Unknown route length"
            : `${row.routeLength} ${row.routeLength === 1 ? "hop" : "hops"}`,
        row,
      })),
    ],
    [vm.report],
  );
  const columns = useMemo<TableColumn<Line>[]>(
    () => [
      {
        key: "label",
        header: "Issuer / route hops",
        width: "190px",
        sortValue: (l) => l.label,
        sortable: true,
        cell: (l) => (
          <span className="font-semibold" data-testid={`quality-row-${l.label}`}>
            {l.label}
          </span>
        ),
      },
      {
        key: "n",
        header: "Fills",
        width: "90px",
        sortable: true,
        sortValue: (l) => l.row.n,
        cell: (l) => <span className="tabular-nums">{l.row.n}</span>,
      },
      {
        key: "fillRate",
        header: (
          <Tip text="Fills that reconciled, out of attempts that finished. Pending attempts are not counted.">
            Fill rate
          </Tip>
        ),
        width: "130px",
        cell: (l) => cell(l.row, (r) => pct(r.fillRate)),
      },
      {
        key: "median",
        header: (
          <Tip text="Received amount against the quote, median. Negative means less than quoted.">
            Vs quote (median)
          </Tip>
        ),
        width: "160px",
        cell: (l) => cell(l.row, (r) => bps(r.vsQuote.medianBps)),
      },
      {
        key: "p90",
        header: "Vs quote (p90)",
        width: "140px",
        cell: (l) => cell(l.row, (r) => bps(r.vsQuote.p90Bps)),
      },
      {
        key: "sim",
        header: "Vs simulation (median)",
        width: "190px",
        cell: (l) => cell(l.row, (r) => bps(r.vsSimulation.medianBps)),
      },
      {
        key: "ref",
        header: "Vs US price (median)",
        width: "180px",
        cell: (l) => cell(l.row, (r) => bps(r.vsReference.medianBps)),
      },
    ],
    [],
  );

  if (vm.state === "error" || vm.state === "disabled")
    return <VmEmpty title="Live fills are unavailable" reason={vm.reason ?? "Couldn't load."} />;
  if (vm.state === "empty")
    return (
      <VmEmpty
        title="No fills recorded yet"
        reason={vm.reason ?? "Live fills has no observations yet."}
      />
    );
  return (
    <>
      {vm.insufficient ? (
        <p
          className="rounded-xl border border-line p-4 text-fg2"
          role="status"
          data-testid="quality-insufficient"
        >
          {vm.reason ?? "Fewer than 5 fills with verified comparisons."} Numbers appear per row once
          it has 5 or more.
        </p>
      ) : null}
      <div className="mt-4">
        <VmFreshness stale={vm.stale} ageMs={vm.ageMs} source={vm.source} fixtures={fixtures} />
      </div>
      <div className="mt-4" data-testid="quality-table" aria-label="Execution quality table">
        <Table
          data={lines}
          columns={columns}
          getRowId={(l) => l.id}
          rowHeight={52}
          height={Math.min(480, (lines.length + 1) * 52 + 4)}
          className="rounded-[18px] !bg-white/[0.03]"
        />
      </div>
      <p className="t-meta mt-2" role="status" aria-live="polite" data-testid="quality-live">
        Updates every {QUALITY_POLL_MS / 1000}s while this page is open.
      </p>
      <p className="t-meta mt-4">
        The US price comparison needs a historical US reference and the spend token&apos;s USD value
        to both be recorded.
      </p>
      {vm.truncated ? (
        <p className="t-meta mt-1">Showing up to 1000 latest observations per kind.</p>
      ) : null}
    </>
  );
}
