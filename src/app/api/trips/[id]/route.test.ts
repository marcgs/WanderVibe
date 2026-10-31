import { connection } from "next/server";
import { beforeEach, expect, test, vi } from "vitest";

const { requireApiUser, tripFindFirst, tripUpdate, loggerInfo } = vi.hoisted(
  () => ({
    requireApiUser: vi.fn(),
    tripFindFirst: vi.fn(),
    tripUpdate: vi.fn(),
    loggerInfo: vi.fn(),
  }),
);

vi.mock("next/server", () => ({
  connection: vi.fn(async () => undefined),
}));

vi.mock("@/lib/require-api-user", () => ({
  requireApiUser,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    trip: {
      findFirst: tripFindFirst,
      update: tripUpdate,
      delete: vi.fn(),
    },
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: loggerInfo,
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

import { GET, PATCH } from "./route";

const user = { id: "user-1", name: "Ada", email: "ada@example.com" };
const title = "Secret Beach Retreat";
const destination = "Hidden Cove";

function unauthorized() {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

function otherUsersTrip() {
  return {
    id: "trip-9",
    title,
    destination,
    startDate: new Date("2027-04-02T00:00:00.000Z"),
    endDate: new Date("2027-04-09T00:00:00.000Z"),
    ownerId: "user-2",
    createdAt: new Date("2027-01-01T00:00:00.000Z"),
    updatedAt: new Date("2027-01-01T00:00:00.000Z"),
  };
}

beforeEach(() => {
  requireApiUser.mockReset();
  tripFindFirst.mockReset();
  tripUpdate.mockReset();
  loggerInfo.mockReset();
  vi.mocked(connection).mockClear();
  requireApiUser.mockResolvedValue(user);
});

test("reading a trip returns 401 when signed out", async () => {
  requireApiUser.mockResolvedValue(unauthorized());

  const response = await GET(
    new Request("http://localhost"),
    context("trip-9"),
  );

  expect(response.status).toBe(401);
  expect(tripFindFirst).not.toHaveBeenCalled();
});

test("another user's trip is not found and is not described", async () => {
  tripFindFirst.mockResolvedValue(otherUsersTrip());

  const response = await GET(
    new Request("http://localhost"),
    context("trip-9"),
  );

  expect(tripFindFirst).toHaveBeenCalledWith({
    where: { id: "trip-9", ownerId: "user-1" },
  });
  expect(response.status).toBe(404);
  expect(response.headers.get("cache-control")).toBe("no-store");
  await expect(response.json()).resolves.toEqual({ error: "not_found" });
  const logged = JSON.stringify(loggerInfo.mock.calls);
  expect(logged).not.toContain(title);
  expect(logged).not.toContain(destination);
});

test("a missing trip is not found", async () => {
  tripFindFirst.mockResolvedValue(null);

  const response = await GET(
    new Request("http://localhost"),
    context("missing"),
  );

  expect(response.status).toBe(404);
  await expect(response.json()).resolves.toEqual({ error: "not_found" });
});

test("the owner can read their trip", async () => {
  tripFindFirst.mockResolvedValue({ ...otherUsersTrip(), ownerId: "user-1" });

  const response = await GET(
    new Request("http://localhost"),
    context("trip-9"),
  );

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    trip: {
      id: "trip-9",
      title,
      destination,
      startDate: "2027-04-02",
      endDate: "2027-04-09",
    },
  });
});

test("changing another user's trip is not found and does not write", async () => {
  tripFindFirst.mockResolvedValue(otherUsersTrip());

  const response = await PATCH(
    new Request("http://localhost", {
      method: "PATCH",
      body: JSON.stringify({ title: "Stolen", destination: "Elsewhere" }),
    }),
    context("trip-9"),
  );

  expect(response.status).toBe(404);
  await expect(response.json()).resolves.toEqual({ error: "not_found" });
  const logged = JSON.stringify(loggerInfo.mock.calls);
  expect(logged).not.toContain("Stolen");
  expect(logged).not.toContain(title);
  expect(logged).not.toContain(destination);
  expect(tripUpdate).not.toHaveBeenCalled();
});

test("the owner cannot change a trip from this story", async () => {
  tripFindFirst.mockResolvedValue({ ...otherUsersTrip(), ownerId: "user-1" });

  const response = await PATCH(
    new Request("http://localhost", { method: "PATCH" }),
    context("trip-9"),
  );

  expect(response.status).toBe(405);
  expect(response.headers.get("allow")).toBe("GET");
  await expect(response.json()).resolves.toEqual({ error: "not_supported" });
  expect(tripUpdate).not.toHaveBeenCalled();
});
