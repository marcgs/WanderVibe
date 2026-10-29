import { expect, test } from "@playwright/test";
import { signInAsTestTraveler } from "./sign-in";

test("home page shows the WanderVibe placeholder", async ({ page }) => {
  await signInAsTestTraveler(page);

  await expect(page.getByRole("heading", { name: "WanderVibe" })).toBeVisible();
  await expect(page.getByText(/Plan a trip in your own time/)).toBeVisible();
});
