import { connection } from "next/server";
import { expect, test, vi } from "vitest";
import { GET } from "./route";

const { queryRaw } = vi.hoisted(() => ({
  queryRaw: vi.fn(),
}));

vi.mock("next/server", () => ({
  connection: vi.fn(async () => undefined),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: queryRaw,
  },
}));

test("health endpoint returns 200 and does not call the database", async () => {
  const response = await GET();

  expect(connection).toHaveBeenCalledTimes(1);
  expect(queryRaw).not.toHaveBeenCalled();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  await expect(response.json()).resolves.toEqual({ status: "ok" });
});
