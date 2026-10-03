import { expect, it } from "vitest";
import { loadFlow } from "./view-model";
it("empty flow view model explains missing observations and never claims a live source", async () => {
  expect(await loadFlow()).toEqual({
    state: "empty",
    stale: false,
    ageMs: null,
    source: null,
    reason: "Flow has no observations yet.",
    error: null,
  });
});
