/** How a Radar grade is made. One list, shown in the Radar modal and in the docs, so the two can never disagree. */
export const GRADE_INTRO =
  "Every token starts at 100 points. Each problem below takes points off, and every deduction is shown with its reason.";

export const GRADE_RULES: readonly (readonly [string, string])[] = [
  [
    "Share counts disagree (−25)",
    "Sources disagree by more than 0.1% on how many shares one token is.",
  ],
  [
    "Price far from the US price (−30)",
    "More than 2% away from the US price while the market is open.",
  ],
  [
    "Almost no trading (−40)",
    "Under $1,000 traded in 24 hours on BNB Chain: a ghost market with stale prices.",
  ],
  ["Paused or limited (−50 / −10)", "The issuer paused the token, or limited it around earnings."],
  ["Status unknown (−10)", "We couldn't read whether it trades, and we never assume it does."],
  ["Old reserve report (−10)", "The issuer's latest reserve attestation is more than 3 days old."],
];

export const GRADE_BANDS =
  "A is 90 or more, B 75, C 60, D 40, F below that. A unit trap (one token being more than one share) adds a badge, not a deduction.";
