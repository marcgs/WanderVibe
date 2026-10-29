import { expect, test } from "vitest";
import { decideAccess } from "./access";

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

test("the test sign-in route is public only while test login is enabled", () => {
  expect(decideAccess("/api/test/session", false, false)).toEqual({
    kind: "unauthorized",
  });
  expect(decideAccess("/api/test/session", false, true)).toEqual({
    kind: "public",
  });
});
