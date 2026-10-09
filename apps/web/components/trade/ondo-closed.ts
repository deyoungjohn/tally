/** Why an Ondo token cannot be sold or migrated while the US market is closed (a plain constant, so tests can import it alone). */
export const ONDO_CLOSED_TIP =
  "Ondo tokens can only be sold while the US market is open. Outside those hours Ondo asks for a signed order, which Tally can't send yet. Try again when the market reopens.";

/** Migrating INTO an Ondo token buys it after the sale, so the same closed market blocks the whole Migrate before anything is sold. */
export const ONDO_CLOSED_MIGRATE_TIP =
  "The Ondo side can only be bought while the US market is open. Outside those hours Ondo asks for a signed order, which Tally can't send yet, so nothing is sold. Try again when the market reopens.";
