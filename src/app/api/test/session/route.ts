import { connection } from "next/server";
import { createTestSession } from "@/lib/create-test-session";
import { isTestLoginEnabled } from "@/lib/test-login";

const noStore = { "cache-control": "no-store" } as const;

// Playwright can also sign in through the button on /signin. This route is the
// same path, and it answers 404 when the flag is off or NODE_ENV is production.
export async function POST() {
  await connection();
  if (!isTestLoginEnabled()) {
    return new Response(null, { status: 404, headers: noStore });
  }
  await createTestSession();
  return Response.json({ ok: true }, { headers: noStore });
}
