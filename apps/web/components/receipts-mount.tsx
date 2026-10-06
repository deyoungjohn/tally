"use client";
// Mounts the receipt recorder once, only while the server's receipts flag is on. It renders nothing and wraps nothing,
// so the page never remounts (CLAUDE.md, "Wallet state never remounts the page").

import { ReceiptRecorder } from "../modules/receipts/recorder";
import { useModuleFlags } from "../lib/hooks/use-flags";

export function ReceiptsMount() {
  const flags = useModuleFlags();
  return flags.receipts === true ? <ReceiptRecorder /> : null;
}
