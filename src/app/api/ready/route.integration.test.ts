// @vitest-environment node

import { afterAll, expect, test, vi } from "vitest";
import { prisma } from "@/lib/prisma";

vi.mock("next/server", () => ({
  connection: vi.fn(async () => undefined),
}));

import { GET } from "./route";

afterAll(async () => {
  await prisma.$disconnect();
});

test("ready endpoint completes a Postgres round-trip", async () => {
  const response = await GET();

  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  await expect(response.json()).resolves.toEqual({ status: "ok" });
});
