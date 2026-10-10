import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { TERMS, TERMS_INTRO } from "@/lib/legal-content";

export const metadata: Metadata = { title: "Terms of Use | Tally" };

export default function Terms() {
  return (
    <LegalPage
      kicker="Legal"
      title="Terms of Use"
      intro={TERMS_INTRO}
      sections={TERMS}
      other={{ href: "/privacy", label: "Privacy Policy" }}
    />
  );
}
