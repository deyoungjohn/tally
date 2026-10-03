import { expect, it } from "vitest";
import { loadAutopilot } from "./view-model";
it("empty autopilot view model explains missing observations and never claims a live source", async () => {
  expect(await loadAutopilot()).toEqual({
    state: "empty",
    stale: false,
    ageMs: null,
    source: null,
    reason: "Autopilot has no observations yet.",
    error: null,
  });
});
