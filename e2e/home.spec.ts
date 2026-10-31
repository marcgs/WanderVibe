import { expect, test } from "@playwright/test";
import { signInAsTestTraveler } from "./sign-in";

test("home page shows the trip list and the new trip form", async ({
  page,
}) => {
  await signInAsTestTraveler(page);

  await expect(page.getByRole("heading", { name: "WanderVibe" })).toBeVisible();
  await expect(page.getByText(/Plan a trip in your own time/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your trips" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "New trip" })).toBeVisible();
  await expect(page.getByLabel("Trip name")).toBeVisible();
});
