/**
 * Turns what a wallet or its RPC says when a send fails into words a person can act on. The raw text from viem and Privy carries the
 * provider's URL, the request body and the library version, none of which belongs on screen.
 */

/** "0.00011" from wei, rounded up so the figure is never lower than what is needed. */
export function bnbFromWei(wei: bigint, decimals = 5): string {
  const scale = 10n ** BigInt(18 - decimals);
  const up = (wei + scale - 1n) / scale;
  const whole = up / 10n ** BigInt(decimals);
  const frac = (up % 10n ** BigInt(decimals)).toString().padStart(decimals, "0");
  return `${whole}.${frac}`;
}

function field(text: string, name: string): bigint | null {
  const m = new RegExp(`${name}\\s+(\\d+)`, "i").exec(text);
  return m ? BigInt(m[1]!) : null;
}

const textOf = (e: unknown): string => {
  const err = e as { message?: unknown; details?: unknown; shortMessage?: unknown };
  return [err?.shortMessage, err?.details, err?.message]
    .filter((v): v is string => typeof v === "string")
    .join(" ");
};

/** The BNB shortfall in an "insufficient funds for gas * price + value" error, when the error says it. */
export function parseInsufficientGas(
  e: unknown,
): { balance: bigint | null; cost: bigint | null } | null {
  const text = textOf(e);
  if (
    !/insufficient funds for gas|insufficient funds for intrinsic|insufficient balance for transfer|exceeds the balance of the account/i.test(
      text,
    )
  )
    return null;
  return { balance: field(text, "balance"), cost: field(text, "tx cost") };
}

export type WalletErrorKind = "needs_gas" | "nonce" | "underpriced" | "unknown";

/** A friendly error with a `kind` the flows can read, or the original error untouched when it is not one we recognise. */
export function friendlyWalletError(e: unknown): Error {
  const gas = parseInsufficientGas(e);
  if (gas) {
    const need =
      gas.cost !== null && gas.balance !== null
        ? ` This transaction needs about ${bnbFromWei(gas.cost)} BNB and your wallet has about ${bnbFromWei(gas.balance)} BNB.`
        : "";
    return Object.assign(
      new Error(
        `You don't have enough BNB to pay the network fee.${need} Add a little BNB (a dollar's worth is plenty) on BNB Smart Chain and try again. Nothing was spent.`,
      ),
      { kind: "needs_gas" as WalletErrorKind },
    );
  }
  const text = textOf(e);
  if (/nonce too low|nonce has already been used/i.test(text))
    return Object.assign(
      new Error(
        "Your wallet has another transaction in progress. Wait for it to finish, then try again.",
      ),
      { kind: "nonce" as WalletErrorKind },
    );
  if (/replacement transaction underpriced|transaction underpriced/i.test(text))
    return Object.assign(
      new Error("The network fee was too low for the network right now. Try again in a moment."),
      { kind: "underpriced" as WalletErrorKind },
    );
  // Unknown: keep the code, drop the noise (URL, request body, library version) so the screen never shows a wall of text.
  const err = e as { shortMessage?: unknown; message?: unknown; code?: unknown };
  const short =
    typeof err?.shortMessage === "string" && err.shortMessage
      ? err.shortMessage
      : typeof err?.message === "string"
        ? err.message.split("\n")[0]!.split(/\s(?:URL|Request body|Version):/)[0]!
        : "";
  if (
    e instanceof Error &&
    short &&
    short !== e.message &&
    /URL:|Request body|Version: viem/i.test(e.message)
  ) {
    console.warn("wallet send failed:", e.message.slice(0, 600));
    return Object.assign(new Error(short.trim()), {
      kind: "unknown" as WalletErrorKind,
      code: err.code,
    });
  }
  return e instanceof Error ? e : new Error(short || "The wallet could not send this transaction.");
}
