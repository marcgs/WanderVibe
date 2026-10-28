// @vitest-environment node

import { afterAll, expect, test } from "vitest";
import { prisma } from "./prisma";

afterAll(async () => {
  await prisma.$disconnect();
});

test("prisma persists a trip in Postgres", async () => {
  const created = await prisma.trip.create({
    data: { title: "Scaffold check" },
  });

  try {
    const found = await prisma.trip.findUnique({ where: { id: created.id } });
    expect(found?.title).toBe("Scaffold check");
  } finally {
    await prisma.trip.delete({ where: { id: created.id } });
  }
});
