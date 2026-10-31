import {
  NextResponse,
  type NextFetchEvent,
  type NextRequest,
} from "next/server";
import { auth } from "@/auth";
import {
  decideAccess,
  enforceAccess,
  isAuthConfigured,
  unauthorizedResponse,
  unconfiguredPageResponse,
} from "@/lib/access";
import { safeCallbackUrl } from "@/lib/callback-url";
import { requestIdFor, runWithRequestId } from "@/lib/request-id";

// Auth.js types this wrapper as a route handler as well as proxy.
const withSession = auth((req) => {
  const decision = decideAccess(
    req.nextUrl.pathname,
    Boolean(req.auth?.user?.id),
  );
  if (decision.kind === "public" || decision.kind === "allow") {
    return NextResponse.next();
  }
  if (decision.kind === "unauthorized" || decision.kind === "unconfigured") {
    return decision.kind === "unauthorized"
      ? unauthorizedResponse()
      : unconfiguredPageResponse();
  }

  const url = req.nextUrl.clone();
  url.pathname = decision.pathname;
  url.search = "";
  const callback = safeCallbackUrl(
    `${req.nextUrl.pathname}${req.nextUrl.search}`,
  );
  if (callback !== "/") {
    url.searchParams.set("callbackUrl", callback);
  }
  return NextResponse.redirect(url);
}) as unknown as (
  request: NextRequest,
  event: NextFetchEvent,
) => Promise<Response>;

// Anonymous probes return before Auth.js looks up a session, so a database
// outage does not fail liveness or the deploy smoke test. When auth is not
// configured, no request calls Auth.js.
export async function proxy(request: NextRequest, event: NextFetchEvent) {
  const requestId = requestIdFor(request.headers);
  try {
    request.headers.set("x-request-id", requestId);
  } catch {
    // A frozen header list still leaves the id in the async store below.
  }
  // One id for every log line in this request when no trace is active.
  return runWithRequestId(requestId, () => handleProxy(request, event));
}

async function handleProxy(request: NextRequest, event: NextFetchEvent) {
  if (!isAuthConfigured()) {
    const decision = enforceAccess(request.nextUrl.pathname, false);
    if (decision.kind === "public") return NextResponse.next();
    if (decision.kind === "unauthorized") return unauthorizedResponse();
    return unconfiguredPageResponse();
  }
  if (decideAccess(request.nextUrl.pathname, false).kind === "public") {
    return NextResponse.next();
  }
  return withSession(request, event);
}

export const config = {
  // /api is always included, even when the path ends in a file extension.
  // Static files outside /api are skipped. Handlers still call requireApiUser().
  matcher: [
    "/api/:path*",
    "/((?!api/|_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
