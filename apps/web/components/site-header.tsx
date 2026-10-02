"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { BottomSheet } from "@/components/motion/bottom-sheet";
import { Button, ButtonLink } from "@/components/motion/button";
import { SharedLayoutBg } from "@/components/motion/shared-layout-bg";

export const NAV_LINKS = [
  { href: "/#compare", label: "Compare" },
  { href: "/#guard", label: "ShareGuard" },
  { href: "/#shield", label: "Trap Shield" },
  { href: "/#faq", label: "FAQ" },
] as const;

export function Logo() {
  return (
    <Link
      href="/"
      className="flex items-center gap-2.5 text-fg no-underline"
      aria-label="Tally home"
    >
      <span aria-hidden className="sphere block h-7 w-7" />
      <span className="text-[17px] font-bold tracking-[-0.03em]">Tally</span>
    </Link>
  );
}

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 px-4 pt-3.5">
      <div className="glass mx-auto flex h-[62px] max-w-[var(--w)] items-center justify-between !rounded-full pl-3 pr-[9px]">
        <Logo />
        <nav aria-label="Primary" className="hidden min-[761px]:block">
          <SharedLayoutBg className="items-center gap-1">
            {NAV_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="nav-link"
                aria-current={pathname === l.href ? "page" : undefined}
              >
                {l.label}
              </Link>
            ))}
          </SharedLayoutBg>
        </nav>
        <div className="flex items-center gap-2">
          <ButtonLink href="/trade/NVDA" className="hidden min-[561px]:inline-flex !h-10">
            Get a quote
          </ButtonLink>
          <span className="min-[761px]:hidden">
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
        <ul className="mt-2 grid gap-2">
          {NAV_LINKS.map((l) => (
            <li key={l.href}>
              <Link
                href={l.href}
                onClick={() => setOpen(false)}
                className="panel flex min-h-14 items-center px-4 text-[17px] font-semibold text-fg no-underline"
              >
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
        <ButtonLink href="/#compare" big className="mt-4" onClick={() => setOpen(false)}>
          Get a quote
        </ButtonLink>
      </BottomSheet>
    </header>
  );
}
