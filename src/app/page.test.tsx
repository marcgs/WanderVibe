import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { HomeScreen } from "./home-screen";
import { TripList } from "./trip-list";

const lisbon = {
  id: "earlier",
  title: "Summer in Lisbon",
  destination: "Lisbon",
  startDate: "2027-06-01",
  endDate: "2027-06-08",
  dateRange: "1 Jun 2027 – 8 Jun 2027",
};

afterEach(() => {
  cleanup();
});

const rome = {
  id: "later",
  title: "Long weekend in Rome",
  destination: "Rome",
  startDate: "2027-08-01",
  endDate: "2027-08-04",
  dateRange: "1 Aug 2027 – 4 Aug 2027",
};

test("the home page shows an empty state and the new trip form", () => {
  render(
    <HomeScreen
      trips={<TripList trips={[]} />}
      form={<button type="submit">Create trip</button>}
    />,
  );

  expect(
    screen.getByRole("heading", { level: 1, name: "WanderVibe" }),
  ).toBeInTheDocument();
  expect(screen.getByText(/Plan a trip in your own time/)).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "No trips yet" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Create your first trip" }),
  ).toHaveAttribute("href", "#title");
  expect(screen.getByRole("heading", { name: "New trip" })).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Create trip" }),
  ).toBeInTheDocument();
});

test("the trip list shows name, destination, and date range in order", () => {
  render(<TripList trips={[lisbon, rome]} />);

  const items = screen.getAllByRole("listitem");
  expect(
    within(items[0]!).getByRole("heading", { name: "Summer in Lisbon" }),
  ).toBeInTheDocument();
  expect(within(items[0]!).getByRole("link")).toHaveAttribute(
    "href",
    "/trips/earlier",
  );
  expect(within(items[0]!).getByText("Lisbon")).toBeInTheDocument();
  expect(
    within(items[0]!).getByText("1 Jun 2027 – 8 Jun 2027"),
  ).toBeInTheDocument();
  expect(
    within(items[1]!).getByRole("heading", { name: "Long weekend in Rome" }),
  ).toBeInTheDocument();
  expect(within(items[1]!).getByText("Rome")).toBeInTheDocument();
  expect(screen.queryByText("No trips yet")).not.toBeInTheDocument();
});
