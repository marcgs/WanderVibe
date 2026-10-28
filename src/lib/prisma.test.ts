import { beforeEach, expect, test, vi } from "vitest";

const { PrismaPg, PrismaClient } = vi.hoisted(() => ({
  PrismaPg: vi.fn(),
  PrismaClient: vi.fn(),
}));

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg,
}));

vi.mock("@/generated/prisma/client", () => ({
  PrismaClient,
}));

import { prisma } from "./prisma";

beforeEach(() => {
  PrismaPg.mockClear();
  PrismaClient.mockClear();
});

test("database client bounds connect and query time", () => {
  void prisma.$disconnect;

  expect(PrismaPg).toHaveBeenCalledWith({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 3000,
    query_timeout: 2500,
  });
});
