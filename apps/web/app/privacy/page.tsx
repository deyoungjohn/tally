import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { PRIVACY, PRIVACY_INTRO } from "@/lib/legal-content";

export const metadata: Metadata = { title: "Privacy Policy | Tally" };

export default function Privacy() {
  return (
    <LegalPage
      kicker="Legal"
      title="Privacy Policy"
      intro={PRIVACY_INTRO}
      sections={PRIVACY}
      other={{ href: "/terms", label: "Terms of Use" }}
    />
  );
}
