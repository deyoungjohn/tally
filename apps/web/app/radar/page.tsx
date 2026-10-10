import type { Metadata } from "next";
import { RadarPage } from "@/components/radar/radar";

export const metadata: Metadata = {
  title: "Radar | Tally",
  description:
    "Every tokenized stock graded A to F for liquidity and data quality, with unit traps flagged before you buy.",
};
export default function Page() {
  return <RadarPage />;
}
