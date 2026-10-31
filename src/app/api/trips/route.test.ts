import { connection } from "next/server";
import { beforeEach, expect, test, vi } from "vitest";
import { tripFieldError } from "@/lib/trip-input";

const { requireApiUser, tripCreate, tripFindMany, loggerInfo } = vi.hoisted(
  () => ({
    requireApiUser: vi.fn(),
    tripCreate: vi.fn(),
    tripFindMany: vi.fn(),
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
      create: tripCreate,
      findMany: tripFindMany,
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

import { GET, POST } from "./route";

const user = { id: "user-1", name: "Ada", email: "ada@example.com" };
const title = "Secret Beach Retreat";
const destination = "Hidden Cove";

function unauthorized() {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}

function post(body: unknown, raw?: string) {
  return new Request("http://localhost/api/trips", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ?? JSON.stringify(body),
  });
}

beforeEach(() => {
  requireApiUser.mockReset();
  tripCreate.mockReset();
  tripFindMany.mockReset();
  loggerInfo.mockReset();
  vi.mocked(connection).mockClear();
});

test("listing trips returns 401 when signed out", async () => {
  requireApiUser.mockResolvedValue(unauthorized());

  const response = await GET();

  expect(connection).toHaveBeenCalledOnce();
  expect(response.status).toBe(401);
  await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
  expect(tripFindMany).not.toHaveBeenCalled();
});

test("listing trips returns only the signed-in user's trips, earliest first", async () => {
  requireApiUser.mockResolvedValue(user);
  tripFindMany.mockResolvedValue([
    {
      id: "later",
      title: "Rome",
      destination: "Italy",
      startDate: new Date("2027-08-01T00:00:00.000Z"),
      endDate: new Date("2027-08-04T00:00:00.000Z"),
      ownerId: "user-1",
    },
    {
      id: "earlier",
      title: "Lisbon",
      destination: "Portugal",
      startDate: new Date("2027-06-01T00:00:00.000Z"),
      endDate: new Date("2027-06-03T00:00:00.000Z"),
      ownerId: "user-1",
    },
  ]);

  const response = await GET();

  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(tripFindMany).toHaveBeenCalledWith({
    where: { ownerId: "user-1" },
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
  });
  await expect(response.json()).resolves.toEqual({
    trips: [
      {
        id: "earlier",
        title: "Lisbon",
        destination: "Portugal",
        startDate: "2027-06-01",
        endDate: "2027-06-03",
      },
      {
        id: "later",
        title: "Rome",
        destination: "Italy",
        startDate: "2027-08-01",
        endDate: "2027-08-04",
      },
    ],
  });
});

test("creating a trip returns 401 when signed out", async () => {
  requireApiUser.mockResolvedValue(unauthorized());

  const response = await POST(
    post({
      title,
      destination,
      startDate: "2027-06-01",
      endDate: "2027-06-08",
    }),
  );

  expect(response.status).toBe(401);
  expect(tripCreate).not.toHaveBeenCalled();
});

test("invalid trip input is not saved", async () => {
  requireApiUser.mockResolvedValue(user);

  const response = await POST(
    post({
      title: "   ",
      destination,
      startDate: "2027-06-08",
      endDate: "2027-06-01",
      ownerId: "someone-else",
    }),
  );

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toEqual({
    error: "invalid",
    fields: {
      title: tripFieldError.titleRequired,
      endDate: tripFieldError.endBeforeStart,
    },
  });
  expect(tripCreate).not.toHaveBeenCalled();
  const logged = JSON.stringify(loggerInfo.mock.calls);
  expect(logged).not.toContain(destination);
});

test("a valid trip is stored for the signed-in user", async () => {
  requireApiUser.mockResolvedValue(user);
  tripCreate.mockResolvedValue({
    id: "trip-1",
    title,
    destination,
    startDate: new Date("2027-06-01T00:00:00.000Z"),
    endDate: new Date("2027-06-08T00:00:00.000Z"),
    ownerId: "user-1",
  });

  const response = await POST(
    post({
      title: `  ${title}  `,
      destination,
      startDate: "2027-06-01",
      endDate: "2027-06-08",
      ownerId: "someone-else",
    }),
  );

  expect(response.status).toBe(201);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(tripCreate).toHaveBeenCalledWith({
    data: {
      title,
      destination,
      startDate: new Date("2027-06-01T00:00:00.000Z"),
      endDate: new Date("2027-06-08T00:00:00.000Z"),
      ownerId: "user-1",
    },
  });
  await expect(response.json()).resolves.toEqual({
    trip: {
      id: "trip-1",
      title,
      destination,
      startDate: "2027-06-01",
      endDate: "2027-06-08",
    },
  });
  const logged = JSON.stringify(loggerInfo.mock.calls);
  expect(logged).not.toContain(title);
  expect(logged).not.toContain(destination);
});

test("a body that is not JSON is rejected", async () => {
  requireApiUser.mockResolvedValue(user);

  const response = await POST(post(undefined, "{"));

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toEqual({
    error: "invalid",
    fields: { form: "The trip could not be read." },
  });
  expect(tripCreate).not.toHaveBeenCalled();
});
