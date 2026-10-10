"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** Copies the link straight to the clipboard (never opens the system share sheet). */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older or non-secure contexts: fall back to a hidden textarea.
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export function ShareReceiptButton({ sellHash, buyHash }: { sellHash: string; buyHash: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const url = `${window.location.origin}/receipt/migrate/${sellHash}/${buyHash}`;
    if (await copyText(url)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="flex justify-center border-t border-white/15 pt-4 mt-2">
      <button
        onClick={handleCopy}
        className="flex items-center gap-2 text-sm px-4 py-2 border border-white/15 rounded-md hover:bg-white/5 transition-colors"
      >
        {copied ? (
          <>
            <Check className="w-4 h-4 text-[var(--orange-text)]" />
            <span className="text-[var(--orange-text)]">Link copied</span>
          </>
        ) : (
          <>
            <Copy className="w-4 h-4" />
            <span>Copy Migrate Receipt Link</span>
          </>
        )}
      </button>
    </div>
  );
}
