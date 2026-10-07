import { z } from "zod";
import { parseDecimal } from "@tally/core";
import {
  DAILY_CEILING,
  MIN_SELL_USD,
  PER_TRADE_CEILING,
  effectiveCaps,
} from "@tally/mod-autopilot";

const usd = z
  .string()
  .max(80)
  .regex(/^\d+(?:\.\d{1,18})?$/, "Use a decimal USD string")
  .transform((value) => parseDecimal(value, 18));
const cap = (ceiling: bigint) =>
  usd.refine(
    (value) => value >= MIN_SELL_USD && value <= ceiling,
    "Cap must be at least 6 USDT and no higher than its code ceiling",
  );
export const policySchema = z
  .object({
    killSwitch: z.boolean().default(true),
    armedRules: z
      .object({
        paused: z
          .object({ longerThanHours: z.number().min(1).max(720) })
          .strict()
          .optional(),
        "grade-drop": z
          .object({ atOrBelow: z.enum(["D", "F"]) })
          .strict()
          .optional(),
        "price-threshold": z
          .object({ stopUsdPerShare: usd.refine((v) => v > 0n, "Stop must be positive") })
          .strict()
          .optional(),
      })
      .strict()
      .default({}),
    perTradeCap: cap(PER_TRADE_CEILING).optional(),
    dailyCap: cap(DAILY_CEILING).optional(),
    tokenAllowList: z
      .array(
        z
          .string()
          .regex(/^0x[0-9a-fA-F]{40}$/)
          .transform((s) => s.toLowerCase()),
      )
      .max(10)
      .refine((values) => new Set(values).size === values.length, "Duplicate token addresses")
      .default([]),
  })
  .strict()
  .refine(
    (policy) => {
      const caps = effectiveCaps(policy);
      return caps.perTrade <= caps.daily;
    },
    { message: "Per-trade cap cannot exceed the daily cap", path: ["perTradeCap"] },
  );
