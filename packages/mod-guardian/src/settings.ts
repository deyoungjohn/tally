import { z } from "zod";
import type { GuardianSettings } from "./types";
import { openStore } from "@tally/modkit";

export function createGuardianSettingsSchema(validTickers: Set<string>) {
  return z
    .object({
      enabled: z.boolean(),
      rules: z
        .object({
          paused: z.boolean(),
          shareCount: z.boolean(),
          gradeDrop: z.boolean(),
          ghost: z.boolean(),
          priceThreshold: z.boolean(),
          earnings: z.boolean().refine((val) => val === false, {
            message: "No earnings-date source is available yet",
          }),
        })
        .strict(),
      priceThresholds: z
        .record(
          z.string().refine((ticker) => validTickers.has(ticker), {
            message: "Invalid ticker",
          }),
          z
            .object({
              minPriceUsd: z.number().positive().finite().optional(),
              maxPriceUsd: z.number().positive().finite().optional(),
            })
            .strict()
            .refine(
              (val) => {
                if (val.minPriceUsd !== undefined && val.maxPriceUsd !== undefined) {
                  return val.minPriceUsd < val.maxPriceUsd;
                }
                return true;
              },
              { message: "minPriceUsd must be less than maxPriceUsd" },
            ),
        )
        .optional()
        .refine((val) => !val || Object.keys(val).length <= 20, {
          message: "Max 20 tickers allowed",
        }),
      quietHours: z
        .object({
          enabled: z.boolean(),
          startHourUtc: z.number().int().min(0).max(23),
          endHourUtc: z.number().int().min(0).max(23),
        })
        .strict()
        .optional(),
      cooldownMs: z.number().int().min(900_000).max(604_800_000).optional(),
    })
    .strict();
}

export function saveGuardianSettings(
  store: ReturnType<typeof openStore>,
  walletAddress: string,
  settings: GuardianSettings,
  now = Date.now(),
) {
  store.put({
    kind: "guardian-settings",
    key: walletAddress.toLowerCase(),
    source: "web-session",
    observedAt: now,
    data: settings,
  });
}
