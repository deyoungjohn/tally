import type { Metadata } from "next";
import { PortfolioPage } from "@/components/portfolio/portfolio";

export const metadata: Metadata = {
  title: "Portfolio | Tally",
  description:
    "Your tokenized stocks across every issuer, counted in shares, with your activity and statements in one place.",
};
export default function Page() {
  return <PortfolioPage />;
}
