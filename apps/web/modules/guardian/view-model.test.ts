import { expect, it } from "vitest";
import { loadGuardian } from "./view-model";
it("empty guardian view model explains missing observations and never claims a live source", async () => {
  expect(await loadGuardian()).toEqual({
    state: "empty",
    stale: false,
    ageMs: null,
    source: null,
    reason: "Guardian has no observations yet.",
    error: null,
  });
});
