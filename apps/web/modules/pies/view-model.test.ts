import { expect, it } from "vitest";
import { loadPies } from "./view-model";
it("empty pies view model explains missing observations and never claims a live source", async () => {
  expect(await loadPies()).toEqual({
    state: "empty",
    stale: false,
    ageMs: null,
    source: null,
    reason: "Pies has no observations yet.",
    error: null,
  });
});
