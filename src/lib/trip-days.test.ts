import { expect, test } from "vitest";
import { formatTripDay, listTripDays } from "./trip-days";

function utc(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

test("a day label uses the weekday, day, short month, and year", () => {
  expect(formatTripDay(utc("2027-01-12"))).toBe("Tue, 12 Jan 2027");
  expect(formatTripDay(utc("2027-01-11"))).toBe("Mon, 11 Jan 2027");
});

test("a single-day trip has exactly one day", () => {
  const days = listTripDays(utc("2027-06-01"), utc("2027-06-01"));

  expect(days).toEqual([{ isoDate: "2027-06-01", label: "Tue, 1 Jun 2027" }]);
});

test("days include the start and the end", () => {
  const days = listTripDays(utc("2027-01-11"), utc("2027-01-13"));

  expect(days.map((day) => day.label)).toEqual([
    "Mon, 11 Jan 2027",
    "Tue, 12 Jan 2027",
    "Wed, 13 Jan 2027",
  ]);
  expect(days.map((day) => day.isoDate)).toEqual([
    "2027-01-11",
    "2027-01-12",
    "2027-01-13",
  ]);
});

test("a month boundary includes the last day and the first of the next month", () => {
  const days = listTripDays(utc("2027-01-31"), utc("2027-02-01"));

  expect(days.map((day) => day.isoDate)).toEqual(["2027-01-31", "2027-02-01"]);
  expect(days.map((day) => day.label)).toEqual([
    "Sun, 31 Jan 2027",
    "Mon, 1 Feb 2027",
  ]);
});

test("a year boundary includes 31 December and 1 January", () => {
  const days = listTripDays(utc("2026-12-31"), utc("2027-01-01"));

  expect(days.map((day) => day.isoDate)).toEqual(["2026-12-31", "2027-01-01"]);
  expect(days.map((day) => day.label)).toEqual([
    "Thu, 31 Dec 2026",
    "Fri, 1 Jan 2027",
  ]);
});

test("a leap year includes 29 February", () => {
  const days = listTripDays(utc("2028-02-28"), utc("2028-03-01"));

  expect(days.map((day) => day.isoDate)).toEqual([
    "2028-02-28",
    "2028-02-29",
    "2028-03-01",
  ]);
});

test("a non-leap February goes from the 28th to 1 March", () => {
  expect(
    listTripDays(utc("2027-02-28"), utc("2027-03-01")).map(
      (day) => day.isoDate,
    ),
  ).toEqual(["2027-02-28", "2027-03-01"]);
  expect(
    listTripDays(utc("1900-02-28"), utc("1900-03-01")).map(
      (day) => day.isoDate,
    ),
  ).toEqual(["1900-02-28", "1900-03-01"]);
  expect(
    listTripDays(utc("2100-02-28"), utc("2100-03-01")).map(
      (day) => day.isoDate,
    ),
  ).toEqual(["2100-02-28", "2100-03-01"]);
});

test("an end date before the start date has no days", () => {
  expect(listTripDays(utc("2027-08-10"), utc("2027-08-01"))).toEqual([]);
});

test("a time of day still counts as that UTC calendar day", () => {
  const days = listTripDays(
    new Date("2027-06-01T23:30:00.000Z"),
    new Date("2027-06-02T00:15:00.000Z"),
  );

  expect(days.map((day) => day.isoDate)).toEqual(["2027-06-01", "2027-06-02"]);
});
