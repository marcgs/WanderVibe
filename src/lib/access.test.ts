import { afterEach, expect, test, vi } from "vitest";
import {
  decideAccess,
  enforceAccess,
  signInNotConfigured,
  unconfiguredPageResponse,
} from "./access";

test("health and ready stay anonymous", () => {
  for (const pathname of ["/api/health", "/api/ready"]) {
    const decision = decideAccess(pathname, false, false);
    expect(decision.kind).not.toBe("redirect");
    expect(decision.kind).not.toBe("unauthorized");
    expect(decision).toEqual({ kind: "public" });
  }
});

test("the sign-in page and the Auth.js callbacks stay anonymous", () => {
  expect(decideAccess("/signin", false, false)).toEqual({ kind: "public" });
  expect(decideAccess("/api/auth/callback/google", false, false)).toEqual({
    kind: "public",
  });
  expect(
    decideAccess("/api/auth/callback/microsoft-entra-id", false, false),
  ).toEqual({ kind: "public" });
});

test("an unsigned page redirects to sign-in and an unsigned API returns 401", () => {
  expect(decideAccess("/", false, false)).toEqual({
    kind: "redirect",
    pathname: "/signin",
  });
  expect(decideAccess("/trips", false, false)).toEqual({
    kind: "redirect",
    pathname: "/signin",
  });
  expect(decideAccess("/api/trips", false, false)).toEqual({
    kind: "unauthorized",
  });
  expect(decideAccess("/api/healthcheck", false, false)).toEqual({
    kind: "unauthorized",
  });
});

test("a signed-in user can open pages and APIs", () => {
  expect(decideAccess("/", true, false)).toEqual({ kind: "allow" });
  expect(decideAccess("/api/trips", true, false)).toEqual({ kind: "allow" });
});

const unconfigured = {
  NODE_ENV: "production",
  AUTH_TEST_LOGIN: "true",
} as const;

test("unconfigured probes stay open and everything else fails closed", async () => {
  expect(enforceAccess("/api/health", false, unconfigured)).toEqual({
    kind: "public",
  });
  expect(enforceAccess("/api/ready", false, unconfigured)).toEqual({
    kind: "public",
  });
  expect(enforceAccess("/", false, unconfigured)).toEqual({
    kind: "unconfigured",
  });
  expect(enforceAccess("/signin", false, unconfigured)).toEqual({
    kind: "unconfigured",
  });
  expect(enforceAccess("/api/trips", false, unconfigured)).toEqual({
    kind: "unauthorized",
  });
  expect(enforceAccess("/api/test/session", false, unconfigured)).toEqual({
    kind: "unauthorized",
  });

  const page = unconfiguredPageResponse();
  expect(page.status).toBe(200);
  expect(page.headers.get("content-type")).toContain("text/plain");
  await expect(page.text()).resolves.toBe(`${signInNotConfigured}\n`);
});

test("the test path keeps the normal gate when a secret is set", () => {
  expect(
    enforceAccess("/", false, {
      NODE_ENV: "test",
      AUTH_TEST_LOGIN: "true",
      AUTH_SECRET: "present",
    }),
  ).toEqual({ kind: "redirect", pathname: "/signin" });
});

test("a secret without a provider still fails closed outside the test path", () => {
  vi.stubEnv("NODE_ENV", "production");
  const env = {
    AUTH_TEST_LOGIN: "true",
    AUTH_SECRET: "present",
  };
  expect(enforceAccess("/", false, env)).toEqual({ kind: "unconfigured" });
  expect(enforceAccess("/api/trips", false, env)).toEqual({
    kind: "unauthorized",
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

test("the test sign-in route is public only while test login is enabled", () => {
  expect(decideAccess("/api/test/session", false, false)).toEqual({
    kind: "unauthorized",
  });
  expect(decideAccess("/api/test/session", false, true)).toEqual({
    kind: "public",
  });
});
