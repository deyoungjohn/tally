"use client";

import { Check, ChevronDown, ChevronUp, Copy, KeyRound, LogOut, Menu, Send } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { MODULE_NAMES, type ModuleName } from "@tally/config";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { Button } from "@/components/motion/button";
import { MorphItem, MorphMenu } from "@/components/motion/morph-menu";
import { Glide } from "@/components/motion/glide";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { SendModal } from "@/components/wallet/send-modal";
import { useTallyWallet } from "@/components/wallet/wallet-context";
import { cn } from "@/lib/utils";

export const NAV_LINKS = [
  { href: "/trade", label: "Trade" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/radar", label: "Radar" },
] as const;

/** Feature-flagged modules from other work orders. Portfolio and Radar are core pages here, so they are not repeated. */
const MODULE_LINKS: { href: string; label: string; flag: ModuleName }[] = [
  { href: "/guardian", label: "Guardian", flag: "guardian" },
  { href: "/pies", label: "Pies", flag: "pies" },
  { href: "/quality", label: "Quality", flag: "quality" },
];

export function Logo() {
  return (
    <Link
      href="/"
      className="flex items-center gap-2.5 text-fg no-underline"
      aria-label="Tally home"
    >
      <span aria-hidden className="sphere block h-7 w-7" />
      <span className="text-[18px] font-bold tracking-[-0.03em]">Tally</span>
    </Link>
  );
}

export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** "Sign in" (opens the sign-in modal) until the user signs in, then their wallet as a short address with a small account menu. */
function AccountButton({
  onNavigate,
  onSend,
  big,
}: {
  onNavigate?: () => void;
  onSend: () => void;
  big?: boolean;
}) {
  const wallet = useTallyWallet();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  // Mobile ("big", inside the bottom sheet) keeps the inline dropdown; desktop uses the morphing panel.
  useEffect(() => {
    if (!open || !big) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open, big]);

  if (!wallet.authenticated || !wallet.address) {
    return (
      <Button
        big={big}
        className={cn(!big && "!h-10")}
        onClick={() => {
          onNavigate?.();
          wallet.login();
        }}
        disabled={!wallet.ready}
        data-testid="nav-sign-in"
      >
        Sign in
      </Button>
    );
  }
  const address = wallet.address;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };
  const ROW =
    "flex min-h-[44px] w-full items-center gap-2 rounded-[14px] px-3 text-left text-[15px] text-fg no-underline hover:bg-[var(--hl-soft)] focus-visible:bg-[var(--hl-soft)]";
  if (!big) {
    const rows = wallet.embedded ? 5 : 4;
    return (
      <div className="relative">
        <Button
          ref={trigger}
          variant="glassy"
          className="!h-10"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          data-testid="account-button"
          style={{ visibility: open ? "hidden" : undefined }}
        >
          <span className="dot-live" aria-hidden />
          <span className="mono text-[15px]">{shortAddress(address)}</span>
          <ChevronDown size={14} aria-hidden />
        </Button>
        <MorphMenu
          open={open}
          onClose={() => setOpen(false)}
          anchor={trigger}
          label="Account"
          rows={rows}
          header={
            <>
              <span className="flex items-center gap-2">
                <span className="dot-live" aria-hidden />
                <span className="mono text-[15px]">{shortAddress(address)}</span>
                <span className="text-xs text-[var(--fg2)]">
                  {wallet.embedded ? "Embedded" : "External wallet"}
                </span>
              </span>
              <ChevronUp size={14} aria-hidden />
            </>
          }
        >
          <MorphItem>
            <button role="menuitem" type="button" className={ROW} onClick={() => void copy()}>
              {copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
              {copied ? "Copied" : "Copy address"}
            </button>
          </MorphItem>
          <MorphItem>
            <button
              role="menuitem"
              type="button"
              className={ROW}
              onClick={() => {
                setOpen(false);
                onNavigate?.();
                onSend();
              }}
              data-testid="menu-send"
            >
              <Send size={15} aria-hidden /> Send
            </button>
          </MorphItem>
          {wallet.embedded ? (
            <MorphItem>
              <button
                role="menuitem"
                type="button"
                className={ROW}
                onClick={() => {
                  setOpen(false);
                  wallet.exportWallet();
                }}
                data-testid="menu-export"
              >
                <KeyRound size={15} aria-hidden /> Export wallet
              </button>
            </MorphItem>
          ) : null}
          <MorphItem>
            <Link role="menuitem" href="/portfolio" className={ROW} onClick={() => setOpen(false)}>
              Portfolio
            </Link>
          </MorphItem>
          <MorphItem>
            <button
              role="menuitem"
              type="button"
              className={ROW}
              onClick={() => {
                setOpen(false);
                wallet.logout();
              }}
            >
              <LogOut size={15} aria-hidden /> Sign out
            </button>
          </MorphItem>
        </MorphMenu>
      </div>
    );
  }
  return (
    <div ref={box} className={cn("relative", big && "w-full")}>
      <Button
        variant="glassy"
        big={big}
        className={cn(!big && "!h-10")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        data-testid="account-button"
      >
        <span className="dot-live" aria-hidden />
        <span className="mono text-[14px]">{shortAddress(address)}</span>
        <ChevronDown size={14} aria-hidden />
      </Button>
      {open ? (
        <div
          role="menu"
          className="glass glass-pop absolute right-0 top-[calc(100%+8px)] z-50 grid min-w-[220px] gap-1 p-2"
        >
          <div className="flex items-center justify-between px-3 py-1.5 text-xs text-[var(--fg2)] border-b border-[var(--border)] mb-1">
            <span className="mono">{shortAddress(address)}</span>
            <span>{wallet.embedded ? "Embedded" : "External wallet"}</span>
          </div>
          <button
            role="menuitem"
            type="button"
            className="flex min-h-[44px] items-center gap-2 rounded-[12px] px-3 text-left text-sm hover:bg-[var(--hl-soft)]"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(address);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {
                /* clipboard blocked */
              }
            }}
          >
            {copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
            {copied ? "Copied" : "Copy address"}
          </button>
          <button
            role="menuitem"
            type="button"
            className="flex min-h-[44px] items-center gap-2 rounded-[12px] px-3 text-left text-sm hover:bg-[var(--hl-soft)]"
            onClick={() => {
              setOpen(false);
              onNavigate?.();
              onSend();
            }}
            data-testid="menu-send"
          >
            <Send size={15} aria-hidden /> Send
          </button>
          {wallet.embedded ? (
            <button
              role="menuitem"
              type="button"
              className="flex min-h-[44px] items-center gap-2 rounded-[12px] px-3 text-left text-sm hover:bg-[var(--hl-soft)]"
              onClick={() => {
                setOpen(false);
                wallet.exportWallet();
              }}
              data-testid="menu-export"
            >
              <KeyRound size={15} aria-hidden /> Export wallet
            </button>
          ) : null}
          <Link
            role="menuitem"
            href="/portfolio"
            onClick={() => {
              setOpen(false);
              onNavigate?.();
            }}
            className="flex min-h-[44px] items-center gap-2 rounded-[12px] px-3 text-sm text-fg no-underline hover:bg-[var(--hl-soft)]"
          >
            Portfolio
          </Link>
          <button
            role="menuitem"
            type="button"
            className="flex min-h-[44px] items-center gap-2 rounded-[12px] px-3 text-left text-sm hover:bg-[var(--hl-soft)]"
            onClick={() => {
              setOpen(false);
              wallet.logout();
            }}
          >
            <LogOut size={15} aria-hidden /> Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [sending, setSending] = useState(false);
  const pathname = usePathname();
  const [enabled, setEnabled] = useState<Partial<Record<ModuleName, boolean>>>({});
  // WO-12 may move these flags into the server layout to render navigation before hydration.
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/modules/health", { signal: controller.signal })
      .then(async (response) => {
        const data: { flags?: Partial<Record<ModuleName, unknown>> } = await response.json();
        setEnabled(
          Object.fromEntries(MODULE_NAMES.map((name) => [name, data.flags?.[name] === true])),
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) console.warn("Module navigation flags unavailable");
      });
    return () => controller.abort();
  }, []);
  const isActive = (href: string) =>
    pathname === href || (!href.includes("#") && pathname.startsWith(href));
  const links = [...NAV_LINKS, ...MODULE_LINKS.filter((link) => enabled[link.flag])];
  const expanded = links.length > NAV_LINKS.length;

  // More opaque and blurrier once the page scrolls, so content passing behind stays faintly visible but never competes with the nav.
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  return (
    <header className="sticky top-0 z-40 px-4 pt-3.5">
      <div
        className={cn(
          "site-bar glass mx-auto flex h-[62px] max-w-[var(--w)] items-center justify-between !rounded-full pl-3 pr-[9px]",
          scrolled && "site-bar-scrolled",
        )}
        data-scrolled={scrolled}
      >
        <Logo />
        <nav
          aria-label="Primary"
          className={expanded ? "hidden min-[1200px]:block" : "hidden min-[761px]:block"}
        >
          <Glide className="flex items-center gap-1">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="nav-link"
                data-glide
                aria-current={isActive(l.href) ? "page" : undefined}
              >
                {l.label}
              </Link>
            ))}
          </Glide>
        </nav>
        <div className="flex items-center gap-2">
          <NotificationBell />
          <span className="hidden min-[561px]:block">
            <AccountButton onSend={() => setSending(true)} />
          </span>
          <span className={expanded ? "min-[1200px]:hidden" : "min-[761px]:hidden"}>
            <Button
              variant="icon"
              aria-label="Open menu"
              aria-haspopup="dialog"
              aria-expanded={open}
              onClick={() => setOpen(true)}
            >
              <Menu size={18} aria-hidden />
            </Button>
          </span>
        </div>
      </div>
      <BottomSheet open={open} onOpenChange={setOpen} snapPoints={["auto"]} title="Menu">
        <Glide as="ul" className="mt-2 grid gap-2" pillClassName="!rounded-[18px]">
          {links.map((l) => (
            <li key={l.href}>
              <Link
                href={l.href}
                onClick={() => setOpen(false)}
                data-glide
                aria-current={isActive(l.href) ? "page" : undefined}
                className="panel flex min-h-14 items-center px-4 text-[18px] font-semibold text-fg no-underline"
              >
                {l.label}
              </Link>
            </li>
          ))}
        </Glide>
        <div className="mt-4">
          <AccountButton big onNavigate={() => setOpen(false)} onSend={() => setSending(true)} />
        </div>
      </BottomSheet>
      <SendModal open={sending} onClose={() => setSending(false)} />
    </header>
  );
}
