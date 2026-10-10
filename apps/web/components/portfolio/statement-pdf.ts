import { jsPDF } from "jspdf";
import type { StatementVM } from "../../modules/statement/view-model";

/** The official Tally home link embedded in exported PDF statements. */
export const TALLY_HOME_URL = "https://tallyprotocol.xyz";

export interface StatementPdfCell {
  text: string;
  align?: "left" | "right";
}

export interface StatementPdfRow {
  cells: StatementPdfCell[];
  rawValues: string[];
}

export interface StatementPdfSection {
  title: string;
  headers: string[];
  colWidths: number[];
  alignments: ("left" | "right")[];
  rows: StatementPdfRow[];
}

export interface StatementPdfDocDescription {
  title: string;
  walletAddress: string;
  period: string;
  generatedAt: string;
  isFixture: boolean;
  fixtureBanner?: string;
  isEmpty: boolean;
  emptyReason?: string;
  summary: {
    totalValueUsd: string;
    totalCostBasisUsd: string;
    totalRealizedPnlUsd: string;
    totalUnrealizedPnlUsd: string;
    differsFromApiNote?: string;
    convertedAtTodaysRatioNote?: string;
    notes: string[];
  };
  sections: StatementPdfSection[];
  totalRowCount: number;
  footerNote: string;
  footerBrand: {
    text: string;
    brandText: string;
    url: string;
  };
  filename: string;
}

/** "0x1234…abcd": short enough for a one-line title. */
export function shortWallet(address?: string | null): string {
  if (!address) return "wallet";
  return address.length > 14 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

/** Formats filename as: tally-statement-<wallet first 6>-<UTC date>.pdf */
export function statementPdfFilename(
  walletAddress?: string | null,
  now: Date | string | number = new Date(),
): string {
  const d = now instanceof Date ? now : new Date(now);
  const pad = (n: number) => String(n).padStart(2, "0");
  const utcDate = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const prefix = walletAddress
    ? walletAddress.startsWith("0x")
      ? walletAddress.slice(0, 8)
      : walletAddress.slice(0, 6)
    : "wallet";
  return `tally-statement-${prefix}-${utcDate}.pdf`;
}

function formatUtcDateTime(now: Date | string | number): string {
  const d = now instanceof Date ? now : new Date(now);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
}

/** Parse raw RFC 4180 CSV lines handling quotes and delimiters */
function parseCsvRows(csv: string): string[][] {
  const lines: string[][] = [];
  const rawLines = csv.split(/\r?\n/);
  for (const raw of rawLines) {
    if (!raw.trim()) continue;
    const row: string[] = [];
    let insideQuotes = false;
    let currentCell = "";
    for (let i = 0; i < raw.length; i++) {
      const char = raw[i];
      if (char === '"') {
        if (insideQuotes && raw[i + 1] === '"') {
          currentCell += '"';
          i++;
        } else {
          insideQuotes = !insideQuotes;
        }
      } else if (char === "," && !insideQuotes) {
        row.push(currentCell.trim());
        currentCell = "";
      } else {
        currentCell += char;
      }
    }
    row.push(currentCell.trim());
    lines.push(row);
  }
  return lines;
}

/**
 * Pure builder: transforms a StatementVM into a pure, testable document description.
 * Ensures rows equal CSV rows, bigints and strings are preserved, and no floating-point conversions happen.
 */
export function buildStatementPdfDescription(
  vm: StatementVM,
  opts?: { now?: Date | string | number; isFixture?: boolean },
): StatementPdfDocDescription {
  const now = opts?.now ?? new Date();
  const isFixture =
    opts?.isFixture ??
    (vm.source?.toLowerCase().includes("fixture") ||
      (typeof process !== "undefined" && process.env?.TALLY_FIXTURES === "1"));

  const generatedAt = formatUtcDateTime(now);
  // "Start date and time to end date and time": the first recorded activity to the moment the statement was read.
  const times = vm.lines.map((l) => Date.parse(l.date)).filter((t) => Number.isFinite(t));
  const endMs =
    vm.asOf && Number.isFinite(Date.parse(vm.asOf)) ? Date.parse(vm.asOf) : new Date(now).getTime();
  const startMs = times.length ? Math.min(...times) : endMs;
  const period = `${formatUtcDateTime(startMs)} to ${formatUtcDateTime(endMs)}`;
  const filename = statementPdfFilename(vm.walletAddress, now);

  const sections: StatementPdfSection[] = [];
  let totalRowCount = 0;

  if (vm.csv?.content) {
    const parsedRows = parseCsvRows(vm.csv.content);
    let currentSection: "none" | "holdings" | "activity" = "none";
    const holdingsDataRows: string[][] = [];
    const activityDataRows: string[][] = [];

    for (const r of parsedRows) {
      if (r[0]?.startsWith("#")) {
        const header = r[0].toLowerCase();
        if (header.includes("holdings")) {
          currentSection = "holdings";
        } else if (header.includes("activity") || header.includes("trades")) {
          currentSection = "activity";
        } else {
          currentSection = "none";
        }
        continue;
      }
      if (currentSection === "holdings") {
        if (r[0] === "Ticker" || r[0] === "Token") continue;
        holdingsDataRows.push(r);
      } else if (currentSection === "activity") {
        if (r[0] === "Date") continue;
        activityDataRows.push(r);
      }
    }

    if (holdingsDataRows.length > 0) {
      const headers = [
        "Token",
        "Issuer",
        "Shares",
        "Price / Share",
        "Value",
        "Avg Cost / Share",
        "Unrealized P&L",
      ];
      const colWidths = [60, 55, 65, 75, 75, 90, 95];
      const alignments: ("left" | "right")[] = [
        "left",
        "left",
        "right",
        "right",
        "right",
        "right",
        "right",
      ];
      const rows: StatementPdfRow[] = holdingsDataRows.map((r) => {
        const token = r[0] || "-";
        const issuer = r[1] || "-";
        const shares = r[6] || "-";
        const pricePerShare = r[7] || "-";
        const value = r[8] || "-";
        const avgCost = r[9] || "-";
        const unrealizedPnl = r[10] || "-";
        return {
          rawValues: r,
          cells: [
            { text: token, align: "left" },
            { text: issuer, align: "left" },
            { text: shares, align: "right" },
            { text: pricePerShare, align: "right" },
            { text: value, align: "right" },
            { text: avgCost, align: "right" },
            { text: unrealizedPnl, align: "right" },
          ],
        };
      });
      sections.push({
        title: "Holdings",
        headers,
        colWidths,
        alignments,
        rows,
      });
      totalRowCount += rows.length;
    }

    if (activityDataRows.length > 0) {
      const headers = [
        "Date",
        "Type",
        "Token",
        "Issuer",
        "Shares",
        "Price / Share",
        "Cost / Proceeds",
        "Realized P&L",
      ];
      const colWidths = [70, 45, 50, 50, 65, 70, 80, 85];
      const alignments: ("left" | "right")[] = [
        "left",
        "left",
        "left",
        "left",
        "right",
        "right",
        "right",
        "right",
      ];
      const rows: StatementPdfRow[] = activityDataRows.map((r) => {
        const date = r[0] ? r[0].slice(0, 10) : "-";
        const type = r[3] || "-";
        const token = r[1] || "-";
        const issuer = r[2] || "-";
        const shares = r[6] || "-";
        const pricePerShare = r[7] || "-";
        const costOrProceeds = r[8] || "-";
        const realizedPnl = r[9] || "-";
        return {
          rawValues: r,
          cells: [
            { text: date, align: "left" },
            { text: type, align: "left" },
            { text: token, align: "left" },
            { text: issuer, align: "left" },
            { text: shares, align: "right" },
            { text: pricePerShare, align: "right" },
            { text: costOrProceeds, align: "right" },
            { text: realizedPnl, align: "right" },
          ],
        };
      });
      sections.push({
        title: "Activity",
        headers,
        colWidths,
        alignments,
        rows,
      });
      totalRowCount += rows.length;
    }
  } else if (vm.lines && vm.lines.length > 0) {
    const headers = [
      "Date",
      "Type",
      "Token",
      "Issuer",
      "Shares",
      "Price / Share",
      "Cost / Proceeds",
      "Realized P&L",
    ];
    const colWidths = [70, 45, 50, 50, 65, 70, 80, 85];
    const alignments: ("left" | "right")[] = [
      "left",
      "left",
      "left",
      "left",
      "right",
      "right",
      "right",
      "right",
    ];
    const rows: StatementPdfRow[] = vm.lines.map((l) => ({
      rawValues: [
        l.date,
        l.ticker,
        l.issuer ?? "unrecognized",
        l.type,
        l.amountShares,
        l.pricePerShareUsd,
        l.valueUsd,
        l.realizedPnlUsd ?? "-",
      ],
      cells: [
        { text: l.date.slice(0, 10), align: "left" },
        { text: l.type === "BUY" ? "Purchase" : "Sale", align: "left" },
        { text: l.ticker, align: "left" },
        { text: l.issuer ?? "unrecognized", align: "left" },
        { text: l.amountShares, align: "right" },
        { text: l.pricePerShareUsd, align: "right" },
        { text: l.valueUsd, align: "right" },
        { text: l.realizedPnlUsd ?? "-", align: "right" },
      ],
    }));
    sections.push({
      title: "Activity",
      headers,
      colWidths,
      alignments,
      rows,
    });
    totalRowCount += rows.length;
  }

  const isEmpty = vm.state === "empty" || totalRowCount === 0;
  const emptyReason = vm.reason ?? vm.asOfReason ?? "Statement has no observations yet.";

  return {
    title: `Statement for ${shortWallet(vm.walletAddress)} Stock Holdings`,
    walletAddress: vm.walletAddress ?? "Unknown wallet",
    period,
    generatedAt,
    isFixture: !!isFixture,
    fixtureBanner: isFixture ? "Fixture data, not live" : undefined,
    isEmpty,
    emptyReason: isEmpty ? emptyReason : undefined,
    summary: {
      totalValueUsd: vm.totalValueUsd,
      totalCostBasisUsd: vm.totalCostBasisUsd,
      totalRealizedPnlUsd: vm.totalRealizedPnlUsd,
      totalUnrealizedPnlUsd: vm.totalUnrealizedPnlUsd,
      differsFromApiNote: vm.differsFromApiNote,
      convertedAtTodaysRatioNote: vm.convertedAtTodaysRatioNote,
      notes: vm.notes ?? [],
    },
    sections,
    totalRowCount,
    footerNote:
      "Tokenized shares track a US stock's price; they are not the underlying shares. This statement is a record of onchain activity, not tax advice.",
    footerBrand: {
      text: "Generated by ",
      brandText: "Tally",
      url: TALLY_HOME_URL,
    },
    filename,
  };
}

/**
 * Draws the Tally logo mark and clickable link on page 1 bottom-right corner.
 * The mark is drawn with 3 filled black rectangles matching apps/web/public/logo.svg geometry scaled to 8pt tall.
 * A single link annotation covers the mark and the word Tally to https://tallyprotocol.xyz.
 */
function renderFirstPageBrand(doc: jsPDF, desc: StatementPdfDocDescription): void {
  doc.setPage(1);

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginRight = 40;
  const marginBottom = 36;
  const rightBound = pageWidth - marginRight;
  const startY = pageHeight - marginBottom;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  const text1 = desc.footerBrand.text;
  const w1 = doc.getTextWidth(text1);

  const markH = 8;
  const scale = markH / 104.88;
  const markW = 82.03 * scale;
  const gap1 = 3;
  const gap2 = 3;

  doc.setFont("helvetica", "bold");
  const text2 = desc.footerBrand.brandText;
  const w2 = doc.getTextWidth(text2);

  const totalW = w1 + gap1 + markW + gap2 + w2;
  const startX = rightBound - totalW;

  // Text: "Generated by "
  doc.setFont("helvetica", "normal");
  doc.setTextColor(60, 60, 60);
  doc.text(text1, startX, startY);

  // Logo mark: 3 filled black rectangles
  const markX = startX + w1 + gap1;
  const markY = startY - 6.5;

  doc.setFillColor(0, 0, 0);
  // 1. Top horizontal bar: width 82.03, height 19.16
  doc.rect(markX, markY, 82.03 * scale, 19.16 * scale, "F");
  // 2. Left vertical bar: x offset 14.2, y offset 22.85, width 19.16, height 82.03
  doc.rect(markX + 14.2 * scale, markY + 22.85 * scale, 19.16 * scale, 82.03 * scale, "F");
  // 3. Right vertical bar: x offset 49.8, y offset 22.85, width 19.16, height 82.03
  doc.rect(markX + 49.8 * scale, markY + 22.85 * scale, 19.16 * scale, 82.03 * scale, "F");

  // Word: "Tally"
  const text2X = markX + markW + gap2;
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0, 0, 0);
  doc.text(text2, text2X, startY);

  // Clickable link over the mark and word
  doc.link(markX, markY, markW + gap2 + w2, markH, { url: desc.footerBrand.url });
}

/**
 * Pure PDF document generator from StatementPdfDocDescription.
 */
export function renderStatementPdf(
  desc: StatementPdfDocDescription,
  opts?: { compress?: boolean },
): jsPDF {
  const doc = new jsPDF({
    format: "a4",
    unit: "pt",
    compress: opts?.compress ?? true,
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 40;
  const marginTop = 40;
  const marginBottom = 50;
  const printableWidth = pageWidth - marginX * 2;

  let currentY = marginTop;

  // Title: "Statement for <wallet> Stock Holdings" (one line)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(0, 0, 0);
  doc.text(desc.title, marginX, currentY + 16);
  currentY += 28;

  // Wallet address (monospace)
  doc.setFont("courier", "normal");
  doc.setFontSize(9);
  doc.setTextColor(70, 70, 70);
  doc.text(desc.walletAddress, marginX, currentY + 8);
  currentY += 16;

  // Period and Generation
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(80, 80, 80);
  doc.text(`Period: ${desc.period}`, marginX, currentY + 8);
  doc.text(`Generated: ${desc.generatedAt}`, marginX, currentY + 20);
  currentY += 28;

  // Prominent Fixture Banner (if fixture data)
  if (desc.isFixture && desc.fixtureBanner) {
    doc.setFillColor(255, 245, 235);
    doc.setDrawColor(240, 140, 60);
    doc.setLineWidth(1);
    doc.roundedRect(marginX, currentY, printableWidth, 24, 3, 3, "FD");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(200, 70, 0);
    doc.text(desc.fixtureBanner, marginX + 10, currentY + 16);
    currentY += 32;
  }

  // Summary Card
  const summaryBoxH = 46;
  doc.setFillColor(248, 249, 250);
  doc.setDrawColor(225, 228, 232);
  doc.setLineWidth(0.8);
  doc.roundedRect(marginX, currentY, printableWidth, summaryBoxH, 3, 3, "FD");

  const colW = printableWidth / 4;
  const summaryItems = [
    { label: "VALUE TODAY", value: `$${desc.summary.totalValueUsd}` },
    { label: "COST BASIS", value: `$${desc.summary.totalCostBasisUsd}` },
    { label: "UNREALIZED P&L", value: `$${desc.summary.totalUnrealizedPnlUsd}` },
    { label: "REALIZED P&L", value: `$${desc.summary.totalRealizedPnlUsd}` },
  ];

  for (let i = 0; i < summaryItems.length; i++) {
    const item = summaryItems[i]!;
    const itemX = marginX + i * colW + 10;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(110, 110, 110);
    doc.text(item.label, itemX, currentY + 15);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(0, 0, 0);
    doc.text(item.value, itemX, currentY + 33);
  }
  currentY += summaryBoxH + 12;

  // Notes if any
  const notes = [
    ...(desc.summary.differsFromApiNote ? [desc.summary.differsFromApiNote] : []),
    ...(desc.summary.convertedAtTodaysRatioNote ? [desc.summary.convertedAtTodaysRatioNote] : []),
    ...desc.summary.notes,
  ];

  if (notes.length > 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(90, 90, 90);
    for (const note of notes) {
      doc.text(`• ${note}`, marginX, currentY + 8, { maxWidth: printableWidth });
      currentY += 14;
    }
    currentY += 6;
  }

  // Empty state handling
  if (desc.isEmpty) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(90, 90, 90);
    doc.text(desc.emptyReason ?? "Statement has no observations yet.", marginX, currentY + 16);
    currentY += 36;
  } else {
    // Render Sections and Tables
    const drawTableHeader = (section: StatementPdfSection, yPos: number): number => {
      doc.setFillColor(242, 244, 246);
      doc.rect(marginX, yPos, printableWidth, 16, "F");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.5);
      doc.setTextColor(60, 60, 60);

      let colX = marginX;
      for (let i = 0; i < section.headers.length; i++) {
        const header = section.headers[i]!;
        const width = section.colWidths[i]!;
        const align = section.alignments[i]!;
        if (align === "right") {
          doc.text(header, colX + width - 4, yPos + 11, { align: "right" });
        } else {
          doc.text(header, colX + 4, yPos + 11, { align: "left" });
        }
        colX += width;
      }
      return yPos + 16;
    };

    for (const section of desc.sections) {
      if (currentY + 40 > pageHeight - marginBottom) {
        doc.addPage();
        currentY = marginTop;
      }

      // Section Title
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(0, 0, 0);
      doc.text(section.title, marginX, currentY + 12);
      currentY += 18;

      // Table Header
      currentY = drawTableHeader(section, currentY);

      // Data Rows
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      const rowHeight = 15;

      for (let rIdx = 0; rIdx < section.rows.length; rIdx++) {
        const row = section.rows[rIdx]!;

        // Page break check
        if (currentY + rowHeight > pageHeight - marginBottom) {
          doc.addPage();
          currentY = marginTop;
          // Repeat column header on new page
          currentY = drawTableHeader(section, currentY);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(8);
        }

        // Row background (zebra striping, dark enough to tell rows apart on paper)
        if (rIdx % 2 === 1) {
          doc.setFillColor(228, 231, 236);
          doc.rect(marginX, currentY, printableWidth, rowHeight, "F");
        }

        // Draw cells
        let colX = marginX;
        doc.setTextColor(0, 0, 0);
        for (let cIdx = 0; cIdx < row.cells.length; cIdx++) {
          const cell = row.cells[cIdx]!;
          const width = section.colWidths[cIdx]!;
          const align = cell.align ?? section.alignments[cIdx] ?? "left";

          if (align === "right") {
            doc.text(cell.text, colX + width - 4, currentY + 11, { align: "right" });
          } else {
            doc.text(cell.text, colX + 4, currentY + 11, { align: "left" });
          }
          colX += width;
        }

        // Row bottom divider
        doc.setDrawColor(238, 240, 242);
        doc.setLineWidth(0.5);
        doc.line(marginX, currentY + rowHeight, marginX + printableWidth, currentY + rowHeight);

        currentY += rowHeight;
      }
      currentY += 14; // Space after section
    }
  }

  // End Footer Note
  if (currentY + 28 > pageHeight - marginBottom) {
    doc.addPage();
    currentY = marginTop;
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(100, 100, 100);
  doc.text(desc.footerNote, marginX, currentY + 12, { maxWidth: printableWidth });

  // First page branding link & logo mark
  renderFirstPageBrand(doc, desc);

  return doc;
}

/** Convenience wrapper: builds document description and renders jsPDF instance */
export function buildStatementPdfDoc(
  vm: StatementVM,
  opts?: { compress?: boolean; now?: Date | string | number; isFixture?: boolean },
): jsPDF {
  const desc = buildStatementPdfDescription(vm, opts);
  return renderStatementPdf(desc, { compress: opts?.compress });
}

/**
 * Triggers a browser download of the statement PDF with the correct filename.
 * Used dynamically on button click so nothing is loaded on initial page load.
 */
export async function downloadStatementPdf(
  vm: StatementVM,
  opts?: { now?: Date | string | number },
): Promise<void> {
  const desc = buildStatementPdfDescription(vm, opts);
  const doc = renderStatementPdf(desc);
  doc.save(desc.filename);
}
