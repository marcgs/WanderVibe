import { expect, test } from "vitest";
import { safeCallbackUrl } from "./callback-url";

test("only same-app paths are kept", () => {
  expect(safeCallbackUrl("/trips")).toBe("/trips");
  expect(safeCallbackUrl(["/trips", "/"])).toBe("/trips");
  expect(safeCallbackUrl("https://evil.example/trips")).toBe("/");
  expect(safeCallbackUrl("//evil.example")).toBe("/");
  expect(safeCallbackUrl("/\\evil")).toBe("/");
  expect(safeCallbackUrl(undefined)).toBe("/");
  expect(safeCallbackUrl("/\t/evil.com")).toBe("/");
  expect(safeCallbackUrl("%2F%2Fevil.com")).toBe("/");
  expect(safeCallbackUrl("javascript:")).toBe("/");
  expect(safeCallbackUrl("/javascript:alert(1)")).toBe("/");
});

test("encoded query parameters are kept as written", () => {
  const callback = "/trips?x=%26y%3D1";
  expect(safeCallbackUrl(callback)).toBe(callback);
  expect(safeCallbackUrl(safeCallbackUrl(callback))).toBe(callback);
  expect(safeCallbackUrl("/?ref=a%26b")).toBe("/?ref=a%26b");
});

test("dot segments cannot escape the app", () => {
  expect(safeCallbackUrl("/.//evil.com")).toBe("/");
  expect(safeCallbackUrl("/%2e%2e/%2fevil.com")).toBe("/");
  expect(safeCallbackUrl("/.%2e/%2fevil.com")).toBe("/");
});
