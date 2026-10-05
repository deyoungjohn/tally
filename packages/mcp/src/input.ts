import { parseDecimal, type Address } from "@tally/core";
import { ToolError } from "./errors";

export function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new ToolError("invalid_request", "Tool arguments must be an object.");
  return value as Record<string, unknown>;
}
export function ticker(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9.]{1,10}$/.test(value))
    throw new ToolError("invalid_request", "Provide a stock ticker, such as NVDA.");
  return value.toUpperCase();
}
export function tickers(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.length > 100)
    throw new ToolError("invalid_request", "Provide 1 to 100 tickers.");
  return [...new Set(value.map(ticker))];
}
export function address(value: unknown): Address {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value) || /^0x0{40}$/i.test(value))
    throw new ToolError("invalid_request", "Provide a nonzero BNB Chain wallet address.");
  return value as Address;
}
export function positive(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    throw new ToolError("invalid_request", `${label} must be a positive number.`);
  return value;
}
export function floorShares(value: unknown): bigint {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,18})?$/.test(value))
    throw new ToolError(
      "invalid_request",
      "minShares must be a decimal string with at most 18 fractional digits.",
    );
  const floor = parseDecimal(value, 18);
  if (floor <= 0n) throw new ToolError("invalid_request", "minShares must be greater than zero.");
  return floor;
}
export function only(args: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(args).some((key) => !keys.includes(key)))
    throw new ToolError("invalid_request", "The request contains unsupported parameters.");
}
