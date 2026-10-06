import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({ pies: false }));
vi.mock("@/lib/flags", () => ({ moduleFlags: () => settings }));
vi.mock("@/modules/pies/plain", () => ({ PiesPlain: () => null }));
vi.mock("@/modules/pies/preview-fixture", () => ({ previewPies: () => null }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("404");
  },
}));
import PiesPreview from "../../app/dev/pies/page";

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => {
  settings.pies = false;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it("FEATURE_PIES off hides the preview even when previews are enabled", () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("TALLY_DEV_PREVIEWS", "1");
  expect(() => PiesPreview()).toThrow("404");
});
it("production hides the enabled pie preview without explicit preview opt-in", () => {
  settings.pies = true;
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("TALLY_DEV_PREVIEWS", "0");
  expect(() => PiesPreview()).toThrow("404");
});
it("explicit opt-in and FEATURE_PIES permit the constructed production preview", () => {
  settings.pies = true;
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("TALLY_DEV_PREVIEWS", "1");
  expect(PiesPreview()).toBeTruthy();
});
