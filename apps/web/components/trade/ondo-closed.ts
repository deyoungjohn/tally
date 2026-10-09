/** Why an Ondo token cannot be sold or migrated while the US market is closed (a plain constant, so tests can import it alone). */
export const ONDO_CLOSED_TIP =
  "Ondo tokens can only be sold while the US market is open. Outside those hours Ondo asks for a signed order, which Tally can't send yet. Try again when the market reopens.";
