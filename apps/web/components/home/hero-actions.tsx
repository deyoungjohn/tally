"use client";

import { ArrowRight } from "lucide-react";
import { ButtonLink } from "@/components/motion/button";
import { useTallyWallet } from "@/components/wallet/wallet-context";

/** The hero's two buttons exist to get a visitor started. Once someone is signed in they are gone (the nav keeps "How it works"). */
export function HeroActions() {
  const wallet = useTallyWallet();
  if (wallet.authenticated) return null;
  return (
    <div className="mt-8 flex flex-wrap gap-3" data-testid="hero-actions">
      <ButtonLink href="/trade">
        Get Started <ArrowRight size={16} aria-hidden />
      </ButtonLink>
      <ButtonLink href="/docs#how" variant="glassy">
        How it works
      </ButtonLink>
    </div>
  );
}
