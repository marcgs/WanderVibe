import { expect, test } from "vitest";
import { isTestLoginEnabled } from "./test-login";

test("test login is on only outside production when the flag is true", () => {
  expect(
    isTestLoginEnabled({ NODE_ENV: "test", AUTH_TEST_LOGIN: "true" }),
  ).toBe(true);
  expect(
    isTestLoginEnabled({ NODE_ENV: "development", AUTH_TEST_LOGIN: "true" }),
  ).toBe(true);
  expect(
    isTestLoginEnabled({ NODE_ENV: "development", AUTH_TEST_LOGIN: "false" }),
  ).toBe(false);
  expect(isTestLoginEnabled({ NODE_ENV: "development" })).toBe(false);
});

test("production ignores AUTH_TEST_LOGIN", () => {
  expect(
    isTestLoginEnabled({ NODE_ENV: "production", AUTH_TEST_LOGIN: "true" }),
  ).toBe(false);
});
