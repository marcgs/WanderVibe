import { expect, type Page } from "@playwright/test";

export async function signInAsTestTraveler(page: Page) {
  await page.goto("/signin");
  await page
    .getByRole("button", { name: "Sign in as test traveler", exact: true })
    .click();
  await expect(page).toHaveURL("/");
}

export async function signInAsOtherTraveler(page: Page) {
  await page.goto("/signin");
  await page
    .getByRole("button", { name: "Sign in as other traveler", exact: true })
    .click();
  await expect(page).toHaveURL("/");
}
