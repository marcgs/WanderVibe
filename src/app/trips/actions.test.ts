import { beforeEach, expect, test, vi } from "vitest";
import { emptyTripFormState, tripFieldError } from "@/lib/trip-input";

const { requireApiUser, createTripForUser, logRejectedTrip, redirect } =
  vi.hoisted(() => ({
    requireApiUser: vi.fn(),
    createTripForUser: vi.fn(),
    logRejectedTrip: vi.fn(),
    redirect: vi.fn(),
  }));

vi.mock("next/navigation", () => ({
  redirect,
}));

vi.mock("@/lib/require-api-user", () => ({
  requireApiUser,
}));

vi.mock("@/lib/trip", () => ({
  createTripForUser,
  logRejectedTrip,
}));

import { createTripAction } from "./actions";

const user = { id: "user-1", name: "Ada", email: "ada@example.com" };

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  requireApiUser.mockReset();
  createTripForUser.mockReset();
  logRejectedTrip.mockReset();
  redirect.mockReset();
  requireApiUser.mockResolvedValue(user);
  redirect.mockImplementation(() => {
    throw new Error("REDIRECT");
  });
});

test("the form action rejects an end date before the start date", async () => {
  const state = await createTripAction(
    emptyTripFormState,
    form({
      title: "Lisbon",
      destination: "Portugal",
      startDate: "2027-06-08",
      endDate: "2027-06-01",
    }),
  );

  expect(state.errors.endDate).toBe(tripFieldError.endBeforeStart);
  expect(createTripForUser).not.toHaveBeenCalled();
  expect(logRejectedTrip).toHaveBeenCalledOnce();
  const logged = JSON.stringify(logRejectedTrip.mock.calls);
  expect(logged).not.toContain("Lisbon");
  expect(logged).not.toContain("Portugal");
});

test("the form action stores a valid trip for the signed-in user", async () => {
  createTripForUser.mockResolvedValue({ id: "trip-1" });

  await expect(
    createTripAction(
      emptyTripFormState,
      form({
        title: "Lisbon",
        destination: "Portugal",
        startDate: "2027-06-01",
        endDate: "2027-06-08",
        ownerId: "someone-else",
      }),
    ),
  ).rejects.toThrow("REDIRECT");

  expect(createTripForUser).toHaveBeenCalledWith("user-1", {
    title: "Lisbon",
    destination: "Portugal",
    startDate: new Date("2027-06-01T00:00:00.000Z"),
    endDate: new Date("2027-06-08T00:00:00.000Z"),
  });
  expect(redirect).toHaveBeenCalledWith("/");
});

test("the form action does not save when signed out", async () => {
  requireApiUser.mockResolvedValue(
    Response.json({ error: "unauthorized" }, { status: 401 }),
  );

  const state = await createTripAction(
    emptyTripFormState,
    form({
      title: "Lisbon",
      destination: "Portugal",
      startDate: "2027-06-01",
      endDate: "2027-06-08",
    }),
  );

  expect(state.errors.form).toBe("Sign in to create a trip.");
  expect(createTripForUser).not.toHaveBeenCalled();
});
