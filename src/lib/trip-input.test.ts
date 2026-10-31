import { expect, test } from "vitest";
import {
  compareTripsByStartDate,
  formatTripDateRange,
  parseTripInput,
  tripDestinationMaxLength,
  tripFieldError,
  tripTitleMaxLength,
  toTripJson,
} from "./trip-input";

const valid = {
  title: "  Summer in Lisbon  ",
  destination: " Lisbon ",
  startDate: "2027-06-01",
  endDate: "2027-06-08",
  ownerId: "someone-else",
};

test("parseTripInput trims the name and destination and ignores an owner id", () => {
  const parsed = parseTripInput(valid);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.value.title).toBe("Summer in Lisbon");
  expect(parsed.value.destination).toBe("Lisbon");
  expect(parsed.value.startDate.toISOString()).toBe("2027-06-01T00:00:00.000Z");
  expect(parsed.value.endDate.toISOString()).toBe("2027-06-08T00:00:00.000Z");
  expect(parsed.value).not.toHaveProperty("ownerId");
});

test("a trip can start and end on the same day", () => {
  const parsed = parseTripInput({ ...valid, endDate: "2027-06-01" });
  expect(parsed.ok).toBe(true);
});

test("missing and blank fields are rejected", () => {
  expect(parseTripInput({})).toEqual({
    ok: false,
    errors: {
      title: tripFieldError.titleRequired,
      destination: tripFieldError.destinationRequired,
      startDate: tripFieldError.startRequired,
      endDate: tripFieldError.endRequired,
    },
  });
  expect(parseTripInput({ ...valid, title: "   ", destination: "" }).ok).toBe(
    false,
  );
});

test("an end date before the start date is rejected", () => {
  const parsed = parseTripInput({ ...valid, endDate: "2027-05-31" });
  expect(parsed).toEqual({
    ok: false,
    errors: { endDate: tripFieldError.endBeforeStart },
  });
});

test("dates must be real calendar days", () => {
  const parsed = parseTripInput({
    ...valid,
    startDate: "2027-02-31",
    endDate: "06/08/2027",
  });
  expect(parsed).toEqual({
    ok: false,
    errors: {
      startDate: tripFieldError.startInvalid,
      endDate: tripFieldError.endInvalid,
    },
  });
});

test("names and destinations have a maximum length", () => {
  const parsed = parseTripInput({
    ...valid,
    title: "a".repeat(tripTitleMaxLength + 1),
    destination: "b".repeat(tripDestinationMaxLength + 1),
  });
  expect(parsed).toEqual({
    ok: false,
    errors: {
      title: tripFieldError.titleTooLong,
      destination: tripFieldError.destinationTooLong,
    },
  });
});

test("trips sort by start date, then id", () => {
  const later = {
    id: "a",
    startDate: new Date("2027-08-01T00:00:00.000Z"),
  };
  const earlier = {
    id: "c",
    startDate: new Date("2027-06-01T00:00:00.000Z"),
  };
  const sameDayB = {
    id: "b",
    startDate: new Date("2027-06-01T00:00:00.000Z"),
  };
  const sorted = [later, sameDayB, earlier].sort(compareTripsByStartDate);
  expect(sorted.map((trip) => trip.id)).toEqual(["b", "c", "a"]);
});

test("a date range is formatted in UTC and collapses a single day", () => {
  const start = new Date("2027-06-01T00:00:00.000Z");
  const end = new Date("2027-06-08T00:00:00.000Z");
  expect(formatTripDateRange(start, end)).toBe("1 Jun 2027 – 8 Jun 2027");
  expect(formatTripDateRange(start, start)).toBe("1 Jun 2027");
  expect(
    toTripJson({
      id: "trip-1",
      title: "Lisbon",
      destination: "Portugal",
      startDate: start,
      endDate: end,
    }),
  ).toEqual({
    id: "trip-1",
    title: "Lisbon",
    destination: "Portugal",
    startDate: "2027-06-01",
    endDate: "2027-06-08",
  });
});
