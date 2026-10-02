import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { WalletRoot } from "@/components/wallet/wallet-context";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-inter",
  display: "swap",
});
const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["500"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Tally: buy tokenized shares, at the best prices",
  description:
    "Compare tokenized versions of the same US stock across Ondo, bStocks and xStocks on BNB Chain, in share units, and buy at the best price with an on-chain minimum-shares guarantee. Not the underlying shares.",
};

export const viewport: Viewport = {
  themeColor: "#1a1b1f",
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
          <div className="relative z-10">
            <SiteHeader />
            {children}
            <SiteFooter />
          </div>
        </WalletRoot>
      </body>
    </html>
  );
}
