import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { isTestLoginEnabled, testTraveler } from "@/lib/test-login";

// Auth.js stores the database session id in this cookie on http.
// Production uses the __Secure- prefix and this module never runs there.
export const sessionCookieName = "authjs.session-token";

const sessionLifetimeMs = 30 * 24 * 60 * 60 * 1000;

export async function createTestSession() {
  if (!isTestLoginEnabled()) {
    throw new Error("Test login is disabled");
  }

  const user = await prisma.user.upsert({
    where: { email: testTraveler.email },
    update: { name: testTraveler.name },
    create: { email: testTraveler.email, name: testTraveler.name },
  });
  const expires = new Date(Date.now() + sessionLifetimeMs);
  const sessionToken = randomBytes(32).toString("hex");
  await prisma.session.create({
    data: { sessionToken, userId: user.id, expires },
  });

  const jar = await cookies();
  jar.set(sessionCookieName, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: false,
    expires,
  });
}
