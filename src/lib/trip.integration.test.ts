// @vitest-environment node

import { afterAll, expect, test } from "vitest";
import {
  createTripForUser,
  listTripsForUser,
  readTripForUser,
} from "@/lib/trip";
import { prisma } from "@/lib/prisma";

const emails = ["trip-owner-a@wandervibe.test", "trip-owner-b@wandervibe.test"];

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { in: emails } } });
  await prisma.$disconnect();
});

test("a saved trip stays in Postgres and only the owner can list it", async () => {
  const owner = await prisma.user.create({
    data: { email: emails[0], name: "Owner" },
  });
  const other = await prisma.user.create({
    data: { email: emails[1], name: "Other" },
  });

  try {
    const later = await createTripForUser(owner.id, {
      title: "Rome",
      destination: "Italy",
      startDate: new Date("2027-08-01T00:00:00.000Z"),
      endDate: new Date("2027-08-04T00:00:00.000Z"),
    });
    const earlier = await createTripForUser(owner.id, {
      title: "Lisbon",
      destination: "Portugal",
      startDate: new Date("2027-06-01T00:00:00.000Z"),
      endDate: new Date("2027-06-08T00:00:00.000Z"),
    });

    const stored = await prisma.trip.findUnique({ where: { id: earlier.id } });
    expect(stored?.ownerId).toBe(owner.id);
    expect(stored?.title).toBe("Lisbon");
    expect(stored?.destination).toBe("Portugal");

    const own = await listTripsForUser(owner.id);
    expect(own.map((trip) => trip.id)).toEqual([earlier.id, later.id]);

    const theirs = await listTripsForUser(other.id);
    expect(theirs).toEqual([]);

    const ownRead = await readTripForUser(owner.id, earlier.id);
    expect(ownRead.status).toBe("ok");
    if (ownRead.status === "ok") {
      expect(ownRead.trip.ownerId).toBe(owner.id);
      expect(ownRead.trip.destination).toBe("Portugal");
    }

    const hidden = await readTripForUser(other.id, earlier.id);
    expect(hidden).toEqual({ status: "not_found" });

    const invalid = await readTripForUser(owner.id, "not-a-trip");
    expect(invalid).toEqual({ status: "not_found" });
  } finally {
    await prisma.user.delete({ where: { id: owner.id } });
    await prisma.user.delete({ where: { id: other.id } });
  }
});
