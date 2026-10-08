"use client";
// FAQ Tabs Card from Spectrum UI (https://ui.spectrumhq.in/docs/faq-tabs-card, Apache-2.0), fetched from its public shadcn
// registry item (https://ui.spectrumhq.in/r/faq-tabs-card.json). Same structure, props and motion; re-skinned with Tally's
// tokens (DESIGN.md) instead of its white / neutral-950 palette, plus tab semantics (tablist, aria-selected, panel) and a tab
// pill scoped with `layoutRoot` so page shifts never replay as pill movement.

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronDown } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export interface FaqItem {
  question: string;
  answer: string;
}

export interface FaqTab {
  label: string;
  faqs: FaqItem[];
}

export interface FAQTabsCardProps {
  tabs?: FaqTab[];
  /** Index of the tab selected initially. */
  defaultTab?: number;
  /** Index of the FAQ expanded initially (-1 for none). */
  defaultOpenIndex?: number;
  footerLabel?: string;
  onFooterClick?: () => void;
  className?: string;
}

const DEFAULT_TABS: FaqTab[] = [
  {
    label: "General",
    faqs: [{ question: "Is my data encrypted?", answer: "Yes, at rest and in transit." }],
  },
];

export function FAQTabsCard({
  tabs: tabsProp = DEFAULT_TABS,
  defaultTab = 0,
  defaultOpenIndex = 0,
  footerLabel = "Contact Support",
  onFooterClick,
  className,
}: FAQTabsCardProps) {
  // Explicit `tabs={[]}` bypasses the default param: fall back so we never read `.faqs` off undefined.
  const tabs = tabsProp.length > 0 ? tabsProp : DEFAULT_TABS;
  const [activeTab, setActiveTab] = React.useState(
    Math.min(Math.max(defaultTab, 0), tabs.length - 1),
  );
  const [openIndex, setOpenIndex] = React.useState(defaultOpenIndex);
  const reduce = useReducedMotion();
  const uid = React.useId();

  const safeActiveTab = Math.min(Math.max(activeTab, 0), tabs.length - 1);
  const currentTab = tabs[safeActiveTab] ?? tabs[0]!;

  const onTabKey = (e: React.KeyboardEvent, i: number) => {
    const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const next = (i + dir + tabs.length) % tabs.length;
    setActiveTab(next);
    setOpenIndex(defaultOpenIndex);
    document.getElementById(`${uid}-tab-${next}`)?.focus();
  };

  return (
    <div
      className={cn("glass flex w-full flex-col !rounded-[26px] p-4 min-[561px]:p-6", className)}
      data-testid="faq-card"
    >
      {/* Tabs */}
      <motion.div
        layoutRoot
        role="tablist"
        aria-label="FAQ topics"
        className="flex h-11 items-center rounded-full border border-[var(--edge)] bg-white/[0.05] p-1"
      >
        {tabs.map((tab, index) => {
          const active = index === safeActiveTab;
          return (
            <button
              key={tab.label}
              id={`${uid}-tab-${index}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`${uid}-panel`}
              tabIndex={active ? 0 : -1}
              onClick={() => {
                setActiveTab(index);
                setOpenIndex(defaultOpenIndex);
              }}
              onKeyDown={(e) => onTabKey(e, index)}
              className="relative h-full flex-1 rounded-full outline-hidden"
            >
              {active ? (
                <motion.span
                  layoutId={`${uid}-faq-tab-pill`}
                  className="absolute inset-0 rounded-full"
                  style={{ background: "linear-gradient(180deg, var(--orange-hi), var(--orange))" }}
                  transition={
                    reduce ? { duration: 0 } : { type: "spring", bounce: 0.2, duration: 0.5 }
                  }
                />
              ) : null}
              <span
                className={cn(
                  "relative z-10 text-sm font-semibold leading-5 transition-colors duration-200",
                  active ? "text-white" : "text-fg2 hover:text-fg",
                )}
              >
                {tab.label}
              </span>
            </button>
          );
        })}
      </motion.div>

      {/* Accordion */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={safeActiveTab}
          id={`${uid}-panel`}
          role="tabpanel"
          aria-labelledby={`${uid}-tab-${safeActiveTab}`}
          initial={{ opacity: 0, y: reduce ? 0 : 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: reduce ? 0 : -6 }}
          transition={{ duration: reduce ? 0.1 : 0.18, ease: "easeOut" }}
          className="mt-3 flex-1 overflow-hidden rounded-[18px] border border-[var(--edge)]"
        >
          {currentTab.faqs.map((faq, index) => {
            const open = index === openIndex;
            return (
              <div
                key={faq.question}
                className={cn(
                  "transition-colors duration-300",
                  index > 0 && "border-t border-[var(--edge)]",
                  open && "bg-white/[0.04]",
                )}
              >
                <button
                  type="button"
                  onClick={() => setOpenIndex(open ? -1 : index)}
                  aria-expanded={open}
                  className="flex min-h-[56px] w-full items-start justify-between gap-4 p-4 text-left"
                >
                  <span className="text-[16px] font-semibold leading-5 text-fg">
                    {faq.question}
                  </span>
                  <motion.span
                    animate={{ rotate: open ? 180 : 0 }}
                    transition={{ duration: reduce ? 0 : 0.25, ease: "easeOut" }}
                    className="flex shrink-0"
                  >
                    <ChevronDown className="h-4 w-4 text-fg" aria-hidden />
                  </motion.span>
                </button>
                <AnimatePresence initial={false}>
                  {open ? (
                    <motion.div
                      key="answer"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: reduce ? 0.1 : 0.3, ease: [0.4, 0, 0.2, 1] }}
                      className="overflow-hidden"
                    >
                      <p className="px-4 pb-[19px] text-[15.5px] leading-6 text-fg2">
                        {faq.answer}
                      </p>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </div>
            );
          })}
        </motion.div>
      </AnimatePresence>

      {/* Footer */}
      <motion.button
        type="button"
        onClick={onFooterClick}
        whileHover={reduce ? undefined : { scale: 1.015 }}
        whileTap={reduce ? undefined : { scale: 0.97 }}
        transition={{ type: "spring", bounce: 0.4, duration: 0.35 }}
        className="btn btn-glassy mt-5 w-full"
      >
        {footerLabel}
      </motion.button>
    </div>
  );
}
