import { describe, expect, it } from "vitest";
import type { Address } from "@tally/core";
import { pauseState } from "./pause";

describe("engine.pauseState (packages/engine/src/pause.ts)", () => {
  const token = "0x1111111111111111111111111111111111111111" as Address;

  const fakeChain = (
    reading: Partial<Awaited<ReturnType<Parameters<typeof pauseState>[0]["readGuard"]>>>,
    throwErr?: Error,
  ): Parameters<typeof pauseState>[0] => ({
    readGuard: async () => {
      if (throwErr) throw throwErr;
      return {
        paused: false,
        enabled: true,
        routerAllowed: true,
        approveTarget: "0x0000000000000000000000000000000000000000" as Address,
        source: 1,
        feed: { multiplier: 10n ** 18n, updatedAt: 0n, validAfter: 0n },
        maxAge: 3600n,
        ...reading,
      };
    },
  });

  it("returns paused: true when tokenPaused is true and asset is enabled", async () => {
    const res = await pauseState(
      fakeChain({ tokenPaused: true, enabled: true }),
      token,
      () => 123456,
    );
    expect(res).toEqual({
      paused: true,
      reason: null,
      observedAt: 123456,
    });
  });

  it("returns paused: false when tokenPaused is false and asset is enabled", async () => {
    const res = await pauseState(
      fakeChain({ tokenPaused: false, enabled: true }),
      token,
      () => 123456,
    );
    expect(res).toEqual({
      paused: false,
      reason: null,
      observedAt: 123456,
    });
  });

  it("returns paused: null with reason when asset is not enabled in ShareGuard", async () => {
    const res = await pauseState(fakeChain({ enabled: false }), token, () => 123456);
    expect(res).toEqual({
      paused: null,
      reason: "token not configured in ShareGuard",
      observedAt: 123456,
    });
  });

  it("returns paused: null with reason when pause check reverted on-chain (tokenPaused is undefined)", async () => {
    const res = await pauseState(
      fakeChain({ tokenPaused: undefined, enabled: true }),
      token,
      () => 123456,
    );
    expect(res).toEqual({
      paused: null,
      reason: "pause check reverted",
      observedAt: 123456,
    });
  });

  it("returns paused: null with fixed reason and withholds URL when readGuard throws with a URL inside the message", async () => {
    const sensitiveUrl = "https://bsc-dataseed.binance.org/v1/SECRET_API_KEY_12345";
    const throwingChain = fakeChain(
      {},
      new Error(`HTTP 500 error connecting to provider at ${sensitiveUrl}: request timed out`),
    );

    const res = await pauseState(throwingChain, token, () => 123456);
    expect(res).toEqual({
      paused: null,
      reason: "guard read failed; details withheld",
      observedAt: 123456,
    });
    expect(res.reason).not.toContain("https://");
    expect(res.reason).not.toContain("SECRET_API_KEY_12345");
  });
});
