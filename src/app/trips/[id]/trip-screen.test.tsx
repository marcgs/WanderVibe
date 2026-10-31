import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { listTripDays } from "@/lib/trip-days";
import { TripScreen } from "./trip-screen";

afterEach(() => {
  cleanup();
});

const kyoto = {
  id: "c000000000000000000000001",
  title: "Spring in Kyoto",
  destination: "Kyoto",
  startDate: "2027-01-11",
  endDate: "2027-01-13",
  dateRange: "11 Jan 2027 – 13 Jan 2027",
};

test("the trip page shows the header and one section per day", () => {
  render(
    <TripScreen
      trip={kyoto}
      days={listTripDays(
        new Date("2027-01-11T00:00:00.000Z"),
        new Date("2027-01-13T00:00:00.000Z"),
      )}
    />,
  );

  expect(
    screen.getByRole("heading", { level: 1, name: "Spring in Kyoto" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Kyoto")).toBeInTheDocument();
  expect(screen.getByText("11 Jan 2027 – 13 Jan 2027")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Your trips" })).toHaveAttribute(
    "href",
    "/",
  );

  const days = screen.getAllByRole("region");
  expect(days.map((day) => day.textContent)).toEqual([
    expect.stringContaining("Mon, 11 Jan 2027"),
    expect.stringContaining("Tue, 12 Jan 2027"),
    expect.stringContaining("Wed, 13 Jan 2027"),
  ]);
});

test("a single-day trip shows exactly one section", () => {
  render(
    <TripScreen
      trip={{
        ...kyoto,
        startDate: "2027-06-01",
        endDate: "2027-06-01",
        dateRange: "1 Jun 2027",
      }}
      days={listTripDays(
        new Date("2027-06-01T00:00:00.000Z"),
        new Date("2027-06-01T00:00:00.000Z"),
      )}
    />,
  );

  expect(screen.getAllByRole("region")).toHaveLength(1);
  expect(
    screen.getByRole("heading", { name: "Tue, 1 Jun 2027" }),
  ).toBeInTheDocument();
});
