import { expect, test } from "vitest";
import { authorizeTrip, isTripId } from "./authorize-trip";

const trip = { ownerId: "owner-1" };

test("a signed-out viewer cannot open a trip", () => {
  expect(authorizeTrip(null, trip)).toEqual({ allowed: false, status: 401 });
  expect(authorizeTrip({ id: "" }, trip)).toEqual({
    allowed: false,
    status: 401,
  });
});

test("the owner can open their trip", () => {
  expect(authorizeTrip({ id: "owner-1" }, trip)).toEqual({ allowed: true });
});

test("another signed-in user gets 404 so the trip is not revealed", () => {
  expect(authorizeTrip({ id: "someone-else" }, trip)).toEqual({
    allowed: false,
    status: 404,
  });
});

test("only a Prisma cuid is a trip id", () => {
  expect(isTripId(`c${"a".repeat(24)}`)).toBe(true);
  expect(isTripId(`c${"0".repeat(24)}`)).toBe(true);
  expect(isTripId("")).toBe(false);
  expect(isTripId("trip-9")).toBe(false);
  expect(isTripId(`c${"a".repeat(23)}`)).toBe(false);
  expect(isTripId(`c${"a".repeat(25)}`)).toBe(false);
  expect(isTripId(`C${"a".repeat(24)}`)).toBe(false);
  expect(isTripId(`c${"a".repeat(23)}\u0000`)).toBe(false);
  expect(isTripId(`c${"a".repeat(23)}\u202e`)).toBe(false);
  expect(isTripId("../c00000000000000000000000")).toBe(false);
});
