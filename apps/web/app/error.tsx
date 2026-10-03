"use client";

import { useEffect } from "react";
import { Button } from "@/components/motion/button";

/** Last-resort page for an unexpected browser-side error: says what happened in words and logs the detail for us. */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Page error:", error);
  }, [error]);
  return (
    <main id="main" className="wrap section-pad">
      <div className="glass mx-auto max-w-[520px] p-6 min-[561px]:p-8" role="alert">
        <h1 className="t-h3">Something went wrong on this page</h1>
        <p className="mt-2 text-fg2">Nothing was spent. Reload to try again.</p>
        <div className="mt-5">
          <Button onClick={reset}>Try again</Button>
        </div>
      </div>
    </main>
  );
}
