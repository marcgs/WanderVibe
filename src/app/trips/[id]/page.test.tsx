import { connection } from "next/server";
import { notFound, redirect } from "next/navigation";
import { beforeEach, expect, test, vi } from "vitest";

const { requireUser, readTripForUser } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  readTripForUser: vi.fn(),
}));

vi.mock("next/server", () => ({
  connection: vi.fn(async () => undefined),
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

vi.mock("@/lib/session", () => ({
  requireUser,
}));

vi.mock("@/lib/trip", () => ({
  readTripForUser,
}));

vi.mock("@/app/account-bar", () => ({
  AccountBar: () => null,
}));

import TripPage from "./page";

const tripId = `c${"b".repeat(24)}`;
const title = "Secret Beach Retreat";
const destination = "Hidden Cove";

const user = { id: "user-1", name: "Ada", email: "ada@example.com" };

function page() {
  return TripPage({
    params: Promise.resolve({ id: tripId }),
    searchParams: Promise.resolve({}),
  });
}

beforeEach(() => {
  requireUser.mockReset();
  readTripForUser.mockReset();
  vi.mocked(connection).mockClear();
  vi.mocked(notFound).mockClear();
  vi.mocked(redirect).mockClear();
  requireUser.mockResolvedValue(user);
});

test("a missing or another user's trip is not found before the page renders", async () => {
  readTripForUser.mockResolvedValue({ status: "not_found" });

  await expect(page()).rejects.toThrow("NOT_FOUND");
  expect(readTripForUser).toHaveBeenCalledWith("user-1", tripId);
  expect(vi.mocked(connection)).toHaveBeenCalled();
  const rendered = JSON.stringify(readTripForUser.mock.calls);
  expect(rendered).not.toContain(title);
  expect(rendered).not.toContain(destination);
});

test("a signed-out result redirects to sign-in and does not show a trip", async () => {
  readTripForUser.mockResolvedValue({ status: "unauthorized" });

  await expect(page()).rejects.toThrow("REDIRECT:/signin");
  expect(vi.mocked(notFound)).not.toHaveBeenCalled();
});

test("the owner receives the trip name and one section per day", async () => {
  readTripForUser.mockResolvedValue({
    status: "ok",
    trip: {
      id: tripId,
      title,
      destination,
      startDate: new Date("2027-01-11T00:00:00.000Z"),
      endDate: new Date("2027-01-11T00:00:00.000Z"),
      ownerId: "user-1",
      createdAt: new Date("2027-01-01T00:00:00.000Z"),
      updatedAt: new Date("2027-01-01T00:00:00.000Z"),
    },
  });

  const view = await page();
  expect(view.props.trip).toMatchObject({
    title,
    destination,
    dateRange: "11 Jan 2027",
  });
  expect(view.props.days).toEqual([
    { isoDate: "2027-01-11", label: "Mon, 11 Jan 2027" },
  ]);
  expect(vi.mocked(notFound)).not.toHaveBeenCalled();
});
