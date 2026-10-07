"use client";

import { FileText } from "lucide-react";
import Link from "next/link";
import { useModuleFlags } from "@/lib/hooks/use-flags";

/** Link to the shareable receipt page. Hidden until the server says the receipts flag is on (the page 404s when it is off). */
export function ReceiptLink({ hash, always }: { hash: string; always?: boolean }) {
  const flags = useModuleFlags();
  if (!always && !flags.receipts) return null;
  return (
    <Link
      href={`/receipt/${hash}`}
      className="btn btn-glassy"
      data-testid="receipt-page-link"
      aria-label="Open the receipt page for this transaction"
    >
      <FileText size={16} aria-hidden /> Receipt
    </Link>
  );
}
