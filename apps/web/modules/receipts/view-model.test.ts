import { expect, it } from "vitest";
import { loadReceipts } from "./view-model";
it("empty receipts view model explains missing observations and never claims a live source", async () => {
  expect(await loadReceipts()).toEqual({
    state: "empty",
    stale: false,
    ageMs: null,
    source: null,
    reason: "Receipts has no observations yet.",
    error: null,
  });
});
