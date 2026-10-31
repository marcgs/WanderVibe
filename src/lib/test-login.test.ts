import { afterEach, expect, test, vi } from "vitest";
import {
  isTestLoginEnabled,
  otherTestTraveler,
  testTraveler,
  testTravelerFor,
} from "./test-login";

afterEach(() => {
  vi.unstubAllEnvs();
});

test("test login is on only outside production when the flag is true", () => {
  vi.stubEnv("NODE_ENV", "test");
  expect(isTestLoginEnabled({ AUTH_TEST_LOGIN: "true" })).toBe(true);

  vi.stubEnv("NODE_ENV", "development");
  expect(isTestLoginEnabled({ AUTH_TEST_LOGIN: "true" })).toBe(true);
  expect(isTestLoginEnabled({ AUTH_TEST_LOGIN: "false" })).toBe(false);
  expect(isTestLoginEnabled({})).toBe(false);
});

test("production ignores AUTH_TEST_LOGIN", () => {
  vi.stubEnv("NODE_ENV", "production");
  expect(isTestLoginEnabled({ AUTH_TEST_LOGIN: "true" })).toBe(false);
});

test("only the other-traveler key selects the second test account", () => {
  expect(testTravelerFor(undefined)).toEqual(testTraveler);
  expect(testTravelerFor("")).toEqual(testTraveler);
  expect(testTravelerFor("playwright-b@wandervibe.test")).toEqual(testTraveler);
  expect(testTravelerFor("other")).toEqual(otherTestTraveler);
});
