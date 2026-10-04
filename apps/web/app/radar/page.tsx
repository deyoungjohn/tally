import type { Metadata } from "next";
import { RadarPage } from "@/components/radar/radar";

export const metadata: Metadata = { title: "Radar: tokens that would mislead you · Tally" };
export default function Page() {
  return <RadarPage />;
}
