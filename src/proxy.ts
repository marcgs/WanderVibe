import {
  NextResponse,
  type NextFetchEvent,
  type NextRequest,
} from "next/server";
import { auth } from "@/auth";
import { decideAccess } from "@/lib/access";
import { safeCallbackUrl } from "@/lib/callback-url";

// Auth.js types this wrapper as a route handler as well as proxy.
const withSession = auth((req) => {
  const decision = decideAccess(
    req.nextUrl.pathname,
    Boolean(req.auth?.user?.id),
  );
  if (decision.kind === "public" || decision.kind === "allow") {
    return NextResponse.next();
  }
  if (decision.kind === "unauthorized") {
    return NextResponse.json(
      { error: "unauthorized" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
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
// outage does not fail liveness or the deploy smoke test.
export async function proxy(request: NextRequest, event: NextFetchEvent) {
  if (decideAccess(request.nextUrl.pathname, false).kind === "public") {
    return NextResponse.next();
  }
  return withSession(request, event);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
