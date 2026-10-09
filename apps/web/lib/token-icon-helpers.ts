import { TOKEN_ICON_FILES } from "./token-icons.generated";

/** File name for a ticker (for example "NVDA.png"), or undefined when none was added yet. */
export function iconFileFor(
  ticker: string,
  files: Readonly<Record<string, string>> = TOKEN_ICON_FILES,
) {
  return Object.hasOwn(files, ticker) ? files[ticker] : undefined;
}

/** The letter shown when there is no picture. USDT keeps its own mark. */
export const fallbackLetter = (ticker: string) =>
  ticker.toUpperCase() === "USDT" ? "₮" : (ticker.trim().charAt(0) || "?").toUpperCase();
