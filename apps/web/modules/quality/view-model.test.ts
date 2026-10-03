import { expect, it } from "vitest";
import { loadQuality } from "./view-model";
it("empty quality view model explains missing observations and never claims a live source", async () => {
  expect(await loadQuality()).toEqual({
    state: "empty",
    stale: false,
    ageMs: null,
    source: null,
    reason: "Quality has no observations yet.",
    error: null,
  });
});
