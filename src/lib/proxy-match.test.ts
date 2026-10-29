import { expect, test } from "vitest";
import { shouldRunProxy } from "./proxy-match";

test("the proxy runs for APIs that look like files and skips static assets", () => {
  expect(shouldRunProxy("/api/x.png")).toBe(true);
  expect(shouldRunProxy("/api/trips")).toBe(true);
  expect(shouldRunProxy("/logo.png")).toBe(false);
  expect(shouldRunProxy("/icon.svg")).toBe(false);
  expect(shouldRunProxy("/signin")).toBe(true);
  expect(shouldRunProxy("/_next/static/chunk.js")).toBe(false);
});
