import { connection } from "next/server";
import { beforeEach, expect, test, vi } from "vitest";
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

beforeEach(() => {
  queryRaw.mockReset();
  vi.mocked(connection).mockClear();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

test("ready endpoint returns ok without the query result", async () => {
  queryRaw.mockResolvedValue([{ secret: "do-not-leak", host: "db.internal" }]);

  const response = await GET();

  expect(connection).toHaveBeenCalledTimes(1);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  await expect(response.json()).resolves.toEqual({ status: "ok" });
  expect(console.error).not.toHaveBeenCalled();
});

test("ready endpoint hides database failures", async () => {
  const leaked =
    "password authentication failed for user wandervibe at db.postgres.database.azure.com";
  queryRaw.mockRejectedValue(new Error(leaked));

  const response = await GET();
  const body = await response.text();

  expect(connection).toHaveBeenCalledTimes(1);
  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(JSON.parse(body)).toEqual({ status: "unavailable" });
  expect(body).not.toContain("password");
  expect(body).not.toContain("wandervibe");
  expect(body).not.toContain("azure.com");
  expect(console.error).toHaveBeenCalledOnce();
  expect(console.error).toHaveBeenCalledWith("Readiness check failed");
  expect(vi.mocked(console.error).mock.calls.flat().join(" ")).not.toContain(
    leaked,
  );
});
