import { issuersOf } from "@/lib/tickers";

/** Migrate moves a holding between the two issuers, so it needs both enabled for the stock. */
export const canMigrateTicker = (ticker: string) => issuersOf(ticker).length >= 2;
