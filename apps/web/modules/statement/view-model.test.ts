import { expect, it } from "vitest";
import { loadStatement } from "./view-model";
it("empty statement view model explains missing observations and never claims a live source", async () => {
  expect(await loadStatement()).toEqual({
    state: "empty",
    stale: false,
    ageMs: null,
    source: null,
    reason: "Statement has no observations yet.",
    error: null,
  });
});
