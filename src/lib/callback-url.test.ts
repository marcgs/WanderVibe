import { expect, test } from "vitest";
import { safeCallbackUrl } from "./callback-url";

test("only same-app paths are kept", () => {
  expect(safeCallbackUrl("/trips")).toBe("/trips");
  expect(safeCallbackUrl(["/trips", "/"])).toBe("/trips");
  expect(safeCallbackUrl("https://evil.example/trips")).toBe("/");
  expect(safeCallbackUrl("//evil.example")).toBe("/");
  expect(safeCallbackUrl("/\\evil")).toBe("/");
  expect(safeCallbackUrl(undefined)).toBe("/");
});
