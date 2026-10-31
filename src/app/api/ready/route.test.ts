import { connection } from "next/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { GET } from "./route";

const { queryRaw, logReadyFailure } = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  logReadyFailure: vi.fn(),
}));

vi.mock("next/server", () => ({
  connection: vi.fn(async () => undefined),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: queryRaw,
  },
}));

vi.mock("@/lib/logger", () => ({
  logReadyFailure,
}));

beforeEach(() => {
  queryRaw.mockReset();
  logReadyFailure.mockReset();
  vi.mocked(connection).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

test("ready endpoint returns ok without the query result", async () => {
  queryRaw.mockResolvedValue([{ secret: "do-not-leak", host: "db.internal" }]);

  const response = await GET();

  expect(connection).toHaveBeenCalledTimes(1);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  await expect(response.json()).resolves.toEqual({ status: "ok" });
  expect(logReadyFailure).not.toHaveBeenCalled();
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
  expect(logReadyFailure).toHaveBeenCalledOnce();
  expect(JSON.stringify(logReadyFailure.mock.calls)).not.toContain(leaked);
  expect(JSON.stringify(logReadyFailure.mock.calls)).not.toContain("password");
});

test("ready endpoint returns 503 when the query never finishes", async () => {
  vi.useFakeTimers();
  queryRaw.mockReturnValue(new Promise(() => undefined));

  const pending = GET();
  await vi.advanceTimersByTimeAsync(2_500);
  const response = await pending;
  const body = await response.text();

  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(JSON.parse(body)).toEqual({ status: "unavailable" });
  expect(body).not.toContain("timeout");
  expect(logReadyFailure).toHaveBeenCalledOnce();
  expect(JSON.stringify(logReadyFailure.mock.calls)).not.toContain("timeout");
});
