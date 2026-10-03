import { expect, it } from "vitest";
import * as module from "./index";
it("module skeleton exports no business logic", () => {
  expect(Object.keys(module)).toEqual([]);
});
