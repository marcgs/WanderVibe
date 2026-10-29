// @vitest-environment node

import { afterAll, expect, test } from "vitest";
import { prisma } from "./prisma";

afterAll(async () => {
  await prisma.$disconnect();
});

test("prisma persists a trip in Postgres", async () => {
  const owner = await prisma.user.create({
    data: { email: "scaffold@wandervibe.test", name: "Scaffold" },
  });
  const created = await prisma.trip.create({
    data: { title: "Scaffold check", ownerId: owner.id },
  });

  try {
    const found = await prisma.trip.findUnique({ where: { id: created.id } });
    expect(found?.title).toBe("Scaffold check");
    expect(found?.ownerId).toBe(owner.id);
  } finally {
    await prisma.user.delete({ where: { id: owner.id } });
  }
});
