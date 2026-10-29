import { isTestLoginEnabled } from "@/lib/test-login";

export type AccessDecision =
  | { kind: "public" }
  | { kind: "allow" }
  | { kind: "redirect"; pathname: "/signin" }
  | { kind: "unauthorized" };

// /api/ready is anonymous so the readiness probe and the deploy smoke test
// still receive 200 without a session. See ADR-0004.
const anonymousApis = new Set(["/api/health", "/api/ready"]);

export function decideAccess(
  pathname: string,
  signedIn: boolean,
  testLogin = isTestLoginEnabled(),
): AccessDecision {
  if (isAnonymousPath(pathname, testLogin)) {
    return { kind: "public" };
  }
  if (signedIn) {
    return { kind: "allow" };
  }
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    return { kind: "unauthorized" };
  }
  return { kind: "redirect", pathname: "/signin" };
}

function isAnonymousPath(pathname: string, testLogin: boolean): boolean {
  if (pathname === "/signin") return true;
  if (pathname === "/api/auth" || pathname.startsWith("/api/auth/"))
    return true;
  if (anonymousApis.has(pathname)) return true;
  if (
    testLogin &&
    (pathname === "/api/test/session" ||
      pathname.startsWith("/api/test/session/"))
  ) {
    return true;
  }
  return false;
}
