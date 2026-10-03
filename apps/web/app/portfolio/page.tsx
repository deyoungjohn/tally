import type { Metadata } from "next";
import { PortfolioPage } from "@/components/portfolio/portfolio";

export const metadata: Metadata = { title: "Portfolio: your tokenized shares · Tally" };
export default function Page() {
  return <PortfolioPage />;
}
