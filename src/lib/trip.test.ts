import { beforeEach, expect, test, vi } from "vitest";

const { tripCreate, tripFindMany, loggerInfo, loggerError } = vi.hoisted(
  () => ({
    tripCreate: vi.fn(),
    tripFindMany: vi.fn(),
    loggerInfo: vi.fn(),
    loggerError: vi.fn(),
  }),
);

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
    error: loggerError,
    warn: vi.fn(),
  },
}));

import { createTripForUser, listTripsForUser } from "./trip";

const input = {
  title: "Secret Beach Retreat",
  destination: "Hidden Cove",
  startDate: new Date("2027-06-01T00:00:00.000Z"),
  endDate: new Date("2027-06-08T00:00:00.000Z"),
};

beforeEach(() => {
  tripCreate.mockReset();
  tripFindMany.mockReset();
  loggerInfo.mockReset();
  loggerError.mockReset();
});

test("listTripsForUser reads only that owner's trips and sorts them", async () => {
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

  const trips = await listTripsForUser("user-1");

  expect(tripFindMany).toHaveBeenCalledWith({
    where: { ownerId: "user-1" },
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
  });
  expect(trips.map((trip) => trip.id)).toEqual(["earlier", "later"]);
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
