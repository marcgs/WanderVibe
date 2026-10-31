import { expect, test, type Page } from "@playwright/test";
import { signInAsTestTraveler } from "./sign-in";

async function createTrip(
  page: Page,
  fields: {
    name: string;
    destination: string;
    startDate: string;
    endDate: string;
  },
) {
  await page.getByLabel("Trip name").fill(fields.name);
  await page.getByLabel("Destination").fill(fields.destination);
  await page.getByLabel("Start date").fill(fields.startDate);
  await page.getByLabel("End date").fill(fields.endDate);
  await page.getByRole("button", { name: "Create trip" }).click();
}

function overflows(page: Page) {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );
}

// Client navigations keep the previous route mounted, so scope to this trip.
function tripMain(page: Page, name: string) {
  return page.locator("main").filter({
    has: page.getByRole("heading", { level: 1, name }),
  });
}

test("open a trip and see one section per day", async ({ page }) => {
  const name = `Kyoto days ${Date.now()}`;
  await signInAsTestTraveler(page);
  await createTrip(page, {
    name,
    destination: "Kyoto",
    startDate: "2027-01-11",
    endDate: "2027-01-13",
  });

  await page
    .getByRole("listitem")
    .filter({ hasText: name })
    .getByRole("link")
    .click();
  await expect(page).toHaveURL(/\/trips\/c[0-9a-z]{24}$/);
  const trip = tripMain(page, name);
  await expect(trip.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(trip.getByText("Kyoto", { exact: true })).toBeVisible();
  await expect(trip.getByText("11 Jan 2027 – 13 Jan 2027")).toBeVisible();
  await expect(
    trip.getByRole("heading", { name: "Mon, 11 Jan 2027" }),
  ).toBeVisible();
  await expect(
    trip.getByRole("heading", { name: "Tue, 12 Jan 2027" }),
  ).toBeVisible();
  await expect(
    trip.getByRole("heading", { name: "Wed, 13 Jan 2027" }),
  ).toBeVisible();
  await expect(trip.getByRole("region")).toHaveCount(3);

  await page.getByRole("link", { name: "Your trips" }).click();
  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("listitem").filter({ hasText: name }),
  ).toBeVisible();
});

test("a single-day trip shows exactly one section", async ({ page }) => {
  const name = `One day ${Date.now()}`;
  await signInAsTestTraveler(page);
  await createTrip(page, {
    name,
    destination: "Porto",
    startDate: "2027-06-01",
    endDate: "2027-06-01",
  });

  await page
    .getByRole("listitem")
    .filter({ hasText: name })
    .getByRole("link")
    .click();
  const trip = tripMain(page, name);
  await expect(trip.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(trip.getByText("1 Jun 2027", { exact: true })).toBeVisible();
  await expect(trip.getByRole("region")).toHaveCount(1);
  await expect(
    trip.getByRole("heading", { name: "Tue, 1 Jun 2027" }),
  ).toBeVisible();
});

test("an unknown trip id shows not-found with a link to the list", async ({
  page,
}) => {
  await signInAsTestTraveler(page);

  const invalid = await page.goto("/trips/not-a-real-trip");
  expect(invalid?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { name: "Trip not found" }),
  ).toBeVisible();
  await expect(page.getByText("That trip does not exist.")).toBeVisible();

  const missing = await page.goto("/trips/c000000000000000000000000");
  expect(missing?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { name: "Trip not found" }),
  ).toBeVisible();
  expect(await page.locator("main").innerText()).not.toContain(
    "c000000000000000000000000",
  );

  await page.getByRole("link", { name: "Back to your trips" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "Your trips" })).toBeVisible();
});

test("the trip page fits a narrow phone and a desktop width", async ({
  page,
}) => {
  const name = `W${"o".repeat(60)}${Date.now()}`;
  await signInAsTestTraveler(page);
  await createTrip(page, {
    name,
    destination: "D".repeat(80),
    startDate: "2027-03-01",
    endDate: "2027-03-03",
  });
  await page
    .getByRole("listitem")
    .filter({ hasText: name })
    .getByRole("link")
    .click();
  await expect(
    tripMain(page, name).getByRole("heading", { level: 1, name }),
  ).toBeVisible();

  for (const width of [320, 375, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    expect(await overflows(page)).toBe(false);
  }
});
