import { expect, it } from "vitest";
import { loadSwitch } from "./view-model";
it("empty switch view model explains missing observations and never claims a live source", async () => {
  expect(await loadSwitch()).toEqual({
    state: "empty",
    stale: false,
    ageMs: null,
    source: null,
    reason: "Switch has no observations yet.",
    error: null,
  });
});
