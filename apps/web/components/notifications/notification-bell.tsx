"use client";
// The bell at the top right: a counter of alerts you have not opened yet, and a liquid-glass dialog with the latest ones.
// Notifications today are Guardian's alerts for the signed-in wallet, so the bell exists only when the `guardian` flag is on
// and someone is signed in. The unread count is kept per wallet in this browser (what you have already seen is not private
// data and never leaves it).

import { Bell } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AlertFeedItemVM, AlertFeedVM } from "@/modules/guardian/view-model";
import { Button } from "@/components/motion/button";
import { Modal } from "@/components/motion/modal";
import { useTallyWallet } from "@/components/wallet/wallet-context";
import { useModuleFlags } from "@/lib/hooks/use-flags";
import { useSessionJson } from "@/lib/hooks/use-session-json";
import { tokenSymbol } from "@/lib/tickers";

const SHOWN = 10;
const seenKey = (address: string) => `tally.notifications.seen:${address.toLowerCase()}`;

export const NOTIFICATIONS_SEEN_EVENT = "tally:notifications-seen";

export const readSeen = (address: string): number => {
  try {
    return Number(window.localStorage.getItem(seenKey(address))) || 0;
  } catch {
    return 0;
  }
};
export const writeSeen = (address: string, at: number) => {
  try {
    window.localStorage.setItem(seenKey(address), String(at));
  } catch {
    /* storage blocked: the count just comes back next visit */
  }
  // Other parts of the page that depend on the count (Guardian's recommendations) read it again.
  window.dispatchEvent(new Event(NOTIFICATIONS_SEEN_EVENT));
};

const SEVERITY: Record<AlertFeedItemVM["severity"], string> = {
  critical: "Critical",
  warning: "Warning",
  info: "Info",
};

export function NotificationBell() {
  const flags = useModuleFlags();
  const wallet = useTallyWallet();
  if (flags.guardian !== true || !wallet.authenticated || !wallet.address) return null;
  return <BellButton address={wallet.address} />;
}

function BellButton({ address }: { address: string }) {
  const feed = useSessionJson<AlertFeedVM>("/api/session/guardian/feed", { refreshMs: 60_000 });
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(0);
  useEffect(() => setSeen(readSeen(address)), [address]);

  const alerts = useMemo(() => {
    const data = "data" in feed.state ? feed.state.data : null;
    return [...(data?.alerts ?? [])].sort((a, b) => b.createdAt - a.createdAt);
  }, [feed.state]);
  const unread = alerts.filter((a) => a.createdAt > seen).length;
  const newest = alerts[0]?.createdAt ?? 0;

  const show = useCallback(() => {
    setOpen(true);
    if (newest > 0) {
      writeSeen(address, newest);
      setSeen(newest);
    }
  }, [address, newest]);

  return (
    <>
      <Button
        variant="icon"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        aria-haspopup="dialog"
        onClick={show}
        data-testid="notification-bell"
        className="relative"
      >
        <Bell size={18} aria-hidden />
        {unread > 0 ? (
          <span
            data-testid="notification-count"
            className="absolute -right-1 -top-1 grid h-[19px] min-w-[19px] place-items-center rounded-full bg-[var(--orange)] px-1 text-[11px] font-bold leading-none text-white"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </Button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Notifications"
        description="The latest alerts for your wallet."
        showClose
      >
        <div data-testid="notification-list">
          {feed.state.status === "unverified" ? (
            <p className="mt-4 text-fg2">We couldn&apos;t verify your sign-in. Sign in again.</p>
          ) : alerts.length === 0 ? (
            <p className="mt-4 text-fg2" data-testid="notification-empty">
              No notifications yet.
            </p>
          ) : (
            <ul className="m-0 mt-4 grid max-h-[min(60vh,440px)] list-none gap-2 overflow-y-auto p-0">
              {alerts.slice(0, SHOWN).map((a) => (
                <li key={a.id} className="panel p-3" data-testid={`notification-${a.id}`}>
                  <p className="flex flex-wrap items-center gap-2 text-[14.5px] font-semibold">
                    {a.title}
                    <span className="badge">{SEVERITY[a.severity]}</span>
                  </p>
                  <p className="mt-1 text-[14px] text-fg2">{a.body}</p>
                  <p className="t-meta mt-1">
                    {tokenSymbol(a.ticker, a.issuer)} · {a.createdAtFormatted}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <Link
            href="/guardian"
            onClick={() => setOpen(false)}
            className="mt-4 inline-flex min-h-[44px] items-center text-[14.5px] link-text"
          >
            Open Guardian
          </Link>
        </div>
      </Modal>
    </>
  );
}
