import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import { BackToTop } from "@/components/back-to-top";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { WalletRoot } from "@/components/wallet/wallet-context";
import { ReceiptsMount } from "@/components/receipts-mount";
import { ActiveWalletRegistrar } from "@/components/wallet/active-wallet-registrar";
import "./globals.css";

// Bundled with the app (SIL Open Font License, see app/fonts/LICENSE.md): a build must never depend on Google being reachable.
const inter = localFont({
  src: "./fonts/Inter-latin-variable.woff2",
  weight: "100 900",
  variable: "--font-inter",
  display: "swap",
});
const jetbrains = localFont({
  src: "./fonts/JetBrainsMono-latin-500.woff2",
  weight: "500",
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  icons: { icon: [{ url: "/favicon.svg", type: "image/svg+xml" }] },
  title: "Tally | The everything app for tokenized stocks on BSC",
  description:
    "Tally is the everything app for tokenized stocks on BNB Smart Chain: compare Ondo, bStocks and xStocks in share units, buy at the best price with a minimum-shares guarantee, migrate between issuers, buy baskets and get alerts. Not the underlying shares.",
};

export const viewport: Viewport = {
  themeColor: "#000000",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable}`} suppressHydrationWarning>
      <body>
        <noscript>
          <style>{".reveal{opacity:1!important;transform:none!important}"}</style>
        </noscript>
        <div className="bg" aria-hidden>
          <div className="dots" />
        </div>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-white focus:px-4 focus:py-2 focus:text-black"
        >
          Skip to content
        </a>
        <WalletRoot>
          <ReceiptsMount />
          <ActiveWalletRegistrar />
          <div className="relative z-10">
            <SiteHeader />
            {children}
            <SiteFooter />
          </div>
          <BackToTop />
        </WalletRoot>
      </body>
    </html>
  );
}
