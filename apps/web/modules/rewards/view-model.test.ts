import { expect, it } from "vitest";
import { loadRewards } from "./view-model";
it("empty rewards view model explains missing observations and never claims a live source", async () => {
  expect(await loadRewards()).toEqual({
    state: "empty",
    stale: false,
    ageMs: null,
    source: null,
    reason: "Rewards has no observations yet.",
    error: null,
  });
});
