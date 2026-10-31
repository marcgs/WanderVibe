import { beforeEach, expect, test, vi } from "vitest";

const { tripCreate, tripFindMany, tripFindFirst, loggerInfo, loggerError } =
  vi.hoisted(() => ({
    tripCreate: vi.fn(),
    tripFindMany: vi.fn(),
    tripFindFirst: vi.fn(),
    loggerInfo: vi.fn(),
    loggerError: vi.fn(),
  }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    trip: {
      create: tripCreate,
      findMany: tripFindMany,
      findFirst: tripFindFirst,
    },
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: loggerInfo,
    error: loggerError,
    warn: vi.fn(),
  },
}));

import { createTripForUser, listTripsForUser, readTripForUser } from "./trip";

const input = {
  title: "Secret Beach Retreat",
  destination: "Hidden Cove",
  startDate: new Date("2027-06-01T00:00:00.000Z"),
  endDate: new Date("2027-06-08T00:00:00.000Z"),
};

const tripId = `c${"a".repeat(24)}`;

beforeEach(() => {
  tripCreate.mockReset();
  tripFindMany.mockReset();
  tripFindFirst.mockReset();
  loggerInfo.mockReset();
  loggerError.mockReset();
});

test("listTripsForUser queries that owner's trips in start-date order", async () => {
  const rows = [
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
  ];
  tripFindMany.mockResolvedValue(rows);

  const trips = await listTripsForUser("user-1");

  expect(tripFindMany).toHaveBeenCalledWith({
    where: { ownerId: "user-1" },
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
  });
  expect(trips.map((trip) => trip.id)).toEqual(["later", "earlier"]);
});

test("createTripForUser stores the signed-in user as owner and does not log the trip", async () => {
  tripCreate.mockResolvedValue({ id: "trip-1", ...input, ownerId: "user-1" });

  await createTripForUser("user-1", input);

  expect(tripCreate).toHaveBeenCalledWith({
    data: { ...input, ownerId: "user-1" },
  });
  const logged = JSON.stringify(loggerInfo.mock.calls);
  expect(loggerInfo).toHaveBeenCalledWith({ tripId: "trip-1" }, "Trip created");
  expect(logged).not.toContain(input.title);
  expect(logged).not.toContain(input.destination);
});

function storedTrip(ownerId: string) {
  return {
    id: tripId,
    title: input.title,
    destination: input.destination,
    startDate: input.startDate,
    endDate: input.endDate,
    ownerId,
    createdAt: new Date("2027-01-01T00:00:00.000Z"),
    updatedAt: new Date("2027-01-01T00:00:00.000Z"),
  };
}

test("readTripForUser returns the owner's trip and does not log it", async () => {
  tripFindFirst.mockResolvedValue(storedTrip("user-1"));

  const result = await readTripForUser("user-1", tripId);

  expect(tripFindFirst).toHaveBeenCalledWith({
    where: { id: tripId, ownerId: "user-1" },
  });
  expect(result).toEqual({ status: "ok", trip: storedTrip("user-1") });
  expect(loggerInfo).not.toHaveBeenCalled();
});

test("a missing trip is not found", async () => {
  tripFindFirst.mockResolvedValue(null);

  await expect(readTripForUser("user-1", tripId)).resolves.toEqual({
    status: "not_found",
  });
  expect(loggerInfo).toHaveBeenCalledWith({ tripId }, "Trip not found");
});

test("another user's trip is not found and its contents are not logged", async () => {
  tripFindFirst.mockResolvedValue(storedTrip("user-2"));

  await expect(readTripForUser("user-1", tripId)).resolves.toEqual({
    status: "not_found",
  });
  const logged = JSON.stringify(loggerInfo.mock.calls);
  expect(logged).not.toContain(input.title);
  expect(logged).not.toContain(input.destination);
  expect(logged).toContain(tripId);
});

test("an id that is not a trip id is not found and is not queried or logged", async () => {
  const supplied = `${input.title}\u0000\u202e`;

  await expect(readTripForUser("user-1", supplied)).resolves.toEqual({
    status: "not_found",
  });
  expect(tripFindFirst).not.toHaveBeenCalled();
  expect(loggerInfo).toHaveBeenCalledWith(
    { reason: "invalid_id" },
    "Trip not found",
  );
  const logged = JSON.stringify(loggerInfo.mock.calls);
  expect(logged).not.toContain(input.title);
  expect(logged).not.toContain("Hidden Cove");
});

test("a signed-out read is unauthorized and does not query", async () => {
  await expect(readTripForUser("", tripId)).resolves.toEqual({
    status: "unauthorized",
  });
  expect(tripFindFirst).not.toHaveBeenCalled();
  expect(loggerInfo).not.toHaveBeenCalled();
});

test("a failed save logs an error code and not the trip", async () => {
  tripCreate.mockRejectedValue(
    Object.assign(new Error(`insert ${input.title} ${input.destination}`), {
      code: "P2002",
    }),
  );

  await expect(createTripForUser("user-1", input)).rejects.toThrow("insert");
  expect(loggerError).toHaveBeenCalledWith(
    { code: "P2002" },
    "Trip create failed",
  );
  const logged = JSON.stringify(loggerError.mock.calls);
  expect(logged).not.toContain(input.title);
  expect(logged).not.toContain(input.destination);
});
