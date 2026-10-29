// @vitest-environment node

import { PrismaAdapter } from "@auth/prisma-adapter";
import { afterAll, expect, test } from "vitest";
import { authorizeTrip } from "@/lib/authorize-trip";
import { prisma } from "@/lib/prisma";

const adapter = PrismaAdapter(
  prisma as unknown as Parameters<typeof PrismaAdapter>[0],
);

afterAll(async () => {
  await prisma.user.deleteMany({
    where: { email: "adapter@wandervibe.test" },
  });
  await prisma.$disconnect();
});

test("the Prisma adapter stores a user, an account, and a session", async () => {
  const user = await adapter.createUser!({
    id: "unused",
    email: "adapter@wandervibe.test",
    emailVerified: null,
    name: "Adapter",
  });
  await adapter.linkAccount!({
    userId: user.id,
    type: "oidc",
    provider: "google",
    providerAccountId: `google-${user.id}`,
  });
  const session = await adapter.createSession!({
    sessionToken: `session-${user.id}`,
    userId: user.id,
    expires: new Date(Date.now() + 60_000),
  });

  const found = await adapter.getSessionAndUser!(session.sessionToken);
  const byAccount = await adapter.getUserByAccount!({
    provider: "google",
    providerAccountId: `google-${user.id}`,
  });
  const trip = await prisma.trip.create({
    data: { title: "Lisbon", ownerId: user.id },
  });

  expect(found?.user.email).toBe("adapter@wandervibe.test");
  expect(found?.session.sessionToken).toBe(session.sessionToken);
  expect(byAccount?.id).toBe(user.id);
  expect(authorizeTrip({ id: user.id }, trip)).toEqual({ allowed: true });
  expect(authorizeTrip({ id: "someone-else" }, trip)).toEqual({
    allowed: false,
    status: 403,
  });
  expect(authorizeTrip(null, trip)).toEqual({ allowed: false, status: 401 });

  await adapter.deleteUser!(user.id);
  await expect(
    prisma.trip.findUnique({ where: { id: trip.id } }),
  ).resolves.toBeNull();
  await expect(
    prisma.session.findUnique({
      where: { sessionToken: session.sessionToken },
    }),
  ).resolves.toBeNull();
});
