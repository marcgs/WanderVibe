import { expect, test } from "vitest";
import { authorizeTrip } from "./authorize-trip";

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
