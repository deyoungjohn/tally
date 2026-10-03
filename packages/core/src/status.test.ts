import { expect, it } from "vitest";
import { sessionFromMarketStatus, statusFromInfo } from "./status";

it("Ondo offhours maps to a closed session (G_underlying_market_NVDAon)", () => {
  expect(sessionFromMarketStatus("offhours")).toBe("closed");
  expect(
    statusFromInfo({ marketStatus: "offhours", openState: false, reasonCode: "MARKET_PAUSED" }),
  ).toMatchObject({ kind: "paused", session: "closed" });
});
it("paused is explicit even when reasonCode says TRADING", () => {
  expect(sessionFromMarketStatus("paused")).toBe("unknown");
  expect(
    statusFromInfo({ marketStatus: "PAUSED", reasonCode: "TRADING", openState: true }),
  ).toMatchObject({ kind: "paused", session: "unknown" });
});
it("null and unfamiliar states stay unknown; existing regular and reason-code mappings remain", () => {
  expect(statusFromInfo(null)).toBeNull();
  expect(sessionFromMarketStatus("new-state")).toBe("unknown");
  expect(statusFromInfo({ marketStatus: "regular", reasonCode: "TRADING" })).toMatchObject({
    kind: "open",
    session: "regular",
  });
  expect(statusFromInfo({ reasonCode: "ASSET_PAUSED" })?.kind).toBe("paused");
});
