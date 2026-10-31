// @vitest-environment node

import { afterAll, expect, test } from "vitest";
import { findOwnedTrip } from "@/lib/authorize-trip";
import { prisma } from "@/lib/prisma";

afterAll(async () => {
  await prisma.user.deleteMany({
    where: {
      email: { in: ["owner-a@wandervibe.test", "owner-b@wandervibe.test"] },
    },
  });
  await prisma.$disconnect();
});

test("findOwnedTrip returns null for another user's trip", async () => {
  const owner = await prisma.user.create({
    data: { email: "owner-a@wandervibe.test", name: "Owner" },
  });
  const other = await prisma.user.create({
    data: { email: "owner-b@wandervibe.test", name: "Other" },
  });
  const trip = await prisma.trip.create({
    data: {
      title: "Lisbon",
      destination: "Portugal",
      startDate: new Date("2026-06-01T00:00:00.000Z"),
      endDate: new Date("2026-06-08T00:00:00.000Z"),
      ownerId: owner.id,
    },
  });

  await expect(findOwnedTrip(other.id, trip.id)).resolves.toBeNull();
  await expect(findOwnedTrip(owner.id, trip.id)).resolves.toMatchObject({
    id: trip.id,
    ownerId: owner.id,
  });

  await prisma.user.delete({ where: { id: owner.id } });
  await prisma.user.delete({ where: { id: other.id } });
});
