import { isAuthConfigured, unauthorizedResponse } from "@/lib/access";
import { currentUser } from "@/lib/session";

// Route handlers and server actions call this even though the proxy already
// gates /api. The proxy skips static files outside /api, not API paths.
// See ADR-0004.
export async function requireApiUser() {
  if (!isAuthConfigured()) return unauthorizedResponse();
  const user = await currentUser();
  if (!user) return unauthorizedResponse();
  return user;
}
