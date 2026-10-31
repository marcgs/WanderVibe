import { trace } from "@opentelemetry/api";
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
import {
  requestIdFor,
  requestIdFrom,
  runWithRequestId,
} from "@/lib/request-id";
import {
  KUBE_PROBE_USER_AGENT,
  PLATFORM_PROBE_ATTRIBUTE,
} from "@/lib/span-export";

// Auth.js types this wrapper as a route handler as well as proxy.
const withSession = auth((req) => {
  const decision = decideAccess(
    req.nextUrl.pathname,
    Boolean(req.auth?.user?.id),
  );
  if (decision.kind === "public" || decision.kind === "allow") {
    return nextWithRequestHeaders(req);
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
    if (decision.kind === "public") return nextWithRequestHeaders(request);
    if (decision.kind === "unauthorized") return unauthorizedResponse();
    return unconfiguredPageResponse();
  }
  if (decideAccess(request.nextUrl.pathname, false).kind === "public") {
    return nextWithRequestHeaders(request);
  }
  return withSession(request, event);
}

// Route handlers do not see proxy AsyncLocalStorage or a mutated request.
// Next copies these headers onto the downstream request.
function nextWithRequestHeaders(request: {
  headers: Headers;
  nextUrl: { pathname: string };
}): NextResponse {
  const headers = new Headers(request.headers);
  headers.set("x-request-id", requestIdFrom(request.headers));
  // A client can send wandervibe.platform_probe. Never forward it. The probe
  // mark is an attribute on this span. The processor reads it when the span ends.
  const baggage = withoutPlatformBaggage(headers.get("baggage"));
  if (baggage) headers.set("baggage", baggage);
  else headers.delete("baggage");
  if (isPlatformProbeRequest(request)) {
    trace.getActiveSpan()?.setAttribute(PLATFORM_PROBE_ATTRIBUTE, "1");
  }
  return NextResponse.next({ request: { headers } });
}

function withoutPlatformBaggage(value: string | null): string | undefined {
  if (!value) return undefined;
  const kept: string[] = [];
  for (const part of value.split(",")) {
    const item = part.trim();
    if (!item) continue;
    const key = item.split(";", 1)[0]?.split("=", 1)[0]?.trim() ?? "";
    let decoded = key;
    try {
      decoded = decodeURIComponent(key);
    } catch {
      decoded = key;
    }
    if (decoded.startsWith("wandervibe.")) continue;
    kept.push(item);
  }
  return kept.length > 0 ? kept.join(",") : undefined;
}

function isPlatformProbeRequest(request: {
  headers: Headers;
  nextUrl: { pathname: string };
}): boolean {
  if (
    request.nextUrl.pathname !== "/api/health" &&
    request.nextUrl.pathname !== "/api/ready"
  ) {
    return false;
  }
  return KUBE_PROBE_USER_AGENT.test(request.headers.get("user-agent") ?? "");
}

export const config = {
  // /api is always included, even when the path ends in a file extension.
  // Static files outside /api are skipped. Handlers still call requireApiUser().
  matcher: [
    "/api/:path*",
    "/((?!api/|_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
