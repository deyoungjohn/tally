"use client";

import { ArrowRight } from "lucide-react";
import { ButtonLink } from "@/components/motion/button";
import { useTallyWallet } from "@/components/wallet/wallet-context";
import { ReturningUser } from "@/components/wallet/returning-user";
import { DEMO_URL } from "@/lib/links";

/** The hero's two buttons exist to get a visitor started. Once someone is signed in they are gone (the nav keeps "How it works"). */
export function HeroActions() {
  const wallet = useTallyWallet();
  if (wallet.authenticated) return null;
  return (
    <div className="mt-8" data-testid="hero-actions">
      <div className="flex flex-wrap gap-3">
        <ButtonLink href="/trade">
          Get Started <ArrowRight size={16} aria-hidden />
        </ButtonLink>
        {/* The "How it works" button was replaced by the demo (the page itself stays in the footer and the Learn more links):
        <ButtonLink href="/how-it-works" variant="glassy">
          How it works
        </ButtonLink>
        */}
        <ButtonLink href={DEMO_URL} variant="glassy" target="_blank" rel="noopener noreferrer">
          Watch the Demo
        </ButtonLink>
      </div>
      <ReturningUser className="mt-4" />
    </div>
  );
}
