"use client";

import { useState } from "react";
import { Check, Share2, Copy } from "lucide-react";

export function ShareReceiptButton({ sellHash, buyHash }: { sellHash: string; buyHash: string }) {
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    const url = `${window.location.origin}/receipt/migrate/${sellHash}/${buyHash}`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: "Tally Receipt",
          url: url,
        });
        return;
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          return;
        }
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      // ignore
    }
  };

  return (
    <div className="flex justify-center border-t border-white/15 pt-4 mt-2">
      <button
        onClick={handleShare}
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
