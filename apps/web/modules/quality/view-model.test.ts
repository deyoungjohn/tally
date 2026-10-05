import { openStore } from "@tally/modkit";
import { expect, it } from "vitest";
import { loadQuality } from "./view-model";
it("empty quality view model explains missing observations and never claims a live source", async () => {
  const store = openStore(":memory:");
  try {
    expect(await loadQuality({ store, enabled: true })).toMatchObject({
      state: "empty",
      stale: false,
      ageMs: null,
      source: null,
      reason: "Quality has no observations yet.",
      error: null,
    });
  } finally {
    store.close();
  }
});
