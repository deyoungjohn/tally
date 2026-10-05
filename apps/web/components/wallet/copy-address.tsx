"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

/** The whole address (never shortened), selectable, with a Copy button. */
export function CopyAddress({ address, className }: { address: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: the address is still selectable */
    }
  };
  return (
    <div className={cn("flex items-start gap-2", className)}>
      <p
        className="mono min-w-0 flex-1 select-all break-all text-[14px] leading-6 text-fg2"
        data-testid="full-address"
      >
        {address}
      </p>
      <button
        type="button"
        onClick={() => void copy()}
        className="btn btn-glassy !h-9 shrink-0 !px-3 text-[14px]"
        aria-label={copied ? "Address copied" : "Copy address"}
        data-testid="copy-address"
      >
        {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
