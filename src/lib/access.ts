import { configuredProviderFlags } from "@/lib/providers";
import { isTestLoginEnabled } from "@/lib/test-login";

export const signInNotConfigured = "Sign-in is not configured yet";

type AuthEnv = {
  NODE_ENV?: string;
  AUTH_TEST_LOGIN?: string;
  AUTH_SECRET?: string;
  AUTH_GOOGLE_ID?: string;
  AUTH_GOOGLE_SECRET?: string;
  AUTH_MICROSOFT_ENTRA_ID_ID?: string;
  AUTH_MICROSOFT_ENTRA_ID_SECRET?: string;
};

export type AccessDecision =
  | { kind: "public" }
  | { kind: "allow" }
  | { kind: "redirect"; pathname: "/signin" }
  | { kind: "unauthorized" }
  | { kind: "unconfigured" };

// AUTH_SECRET missing, or no OAuth provider and no test sign-in path.
// The test path cannot turn this on in production. See isTestLoginEnabled.
export function isAuthConfigured(env: AuthEnv = process.env): boolean {
  if (!env.AUTH_SECRET?.trim()) return false;
  if (isTestLoginEnabled(env)) return true;
  const providers = configuredProviderFlags(env as NodeJS.ProcessEnv);
  return providers.google || providers.microsoft;
}

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

export function enforceAccess(
  pathname: string,
  signedIn: boolean,
  env: AuthEnv = process.env,
): AccessDecision {
  if (anonymousApis.has(pathname)) return { kind: "public" };
  if (!isAuthConfigured(env)) {
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      return { kind: "unauthorized" };
    }
    return { kind: "unconfigured" };
  }
  return decideAccess(pathname, signedIn, isTestLoginEnabled(env));
}

export function unconfiguredPageResponse(): Response {
  return new Response(`${signInNotConfigured}\n`, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export function unauthorizedResponse(): Response {
  return Response.json(
    { error: "unauthorized" },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
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
