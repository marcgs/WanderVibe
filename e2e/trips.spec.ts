import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { signInAsOtherTraveler, signInAsTestTraveler } from "./sign-in";

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

test("create a trip and see it after reload", async ({ page }) => {
  const name = `Lisbon ${Date.now()}`;
  await signInAsTestTraveler(page);
  await createTrip(page, {
    name,
    destination: "Lisbon",
    startDate: "2027-06-01",
    endDate: "2027-06-08",
  });

  const item = page.getByRole("listitem").filter({ hasText: name });
  await expect(item).toBeVisible();
  await expect(item).toContainText("Lisbon");
  await expect(item).toContainText("1 Jun 2027 – 8 Jun 2027");

  await page.reload();
  await expect(item).toBeVisible();
});

test("invalid trip input stays on the form and is not listed", async ({
  page,
}) => {
  const name = `Too early ${Date.now()}`;
  await signInAsTestTraveler(page);
  await page.getByRole("button", { name: "Create trip" }).click();
  await expect(page.getByText("Enter a trip name.")).toBeVisible();
  await expect(page.getByText("Enter a destination.")).toBeVisible();
  await expect(page.getByText("Enter a start date.")).toBeVisible();
  await expect(page.getByText("Enter an end date.")).toBeVisible();

  await createTrip(page, {
    name,
    destination: "Porto",
    startDate: "2027-08-10",
    endDate: "2027-08-01",
  });
  await expect(
    page.getByText("End date must be on or after the start date."),
  ).toBeVisible();
  await expect(page.getByLabel("Trip name")).toHaveValue(name);
  await expect(page.getByLabel("Destination")).toHaveValue("Porto");
  await expect(page.getByLabel("Start date")).toHaveValue("2027-08-10");
  await expect(page.getByLabel("End date")).toHaveValue("2027-08-01");
  await expect(page.getByLabel("End date")).toBeFocused();
  await expect(
    page.getByRole("listitem").filter({ hasText: name }),
  ).toHaveCount(0);
});

test("a traveler with no trips sees a call to action", async ({ page }) => {
  await signInAsOtherTraveler(page);
  await expect(
    page.getByRole("heading", { name: "No trips yet" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Create your first trip" }).click();
  await expect(page.getByLabel("Trip name")).toBeFocused();
  await expect(page.getByRole("heading", { name: "New trip" })).toBeVisible();
});

test("the trip list fits a phone width and a desktop width", async ({
  page,
}) => {
  const name = `Narrow ${Date.now()}`;
  await signInAsTestTraveler(page);
  await createTrip(page, {
    name,
    destination: "X".repeat(80),
    startDate: "2027-03-01",
    endDate: "2027-03-02",
  });
  await expect(
    page.getByRole("listitem").filter({ hasText: name }),
  ).toBeVisible();

  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    expect(await overflows(page)).toBe(false);
  }
});

test("another traveler gets 404 and does not see the trip", async ({
  browser,
}) => {
  const name = `Private ${Date.now()}`;
  let contextA: BrowserContext | undefined;
  let contextB: BrowserContext | undefined;
  try {
    contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    await signInAsTestTraveler(pageA);
    await createTrip(pageA, {
      name,
      destination: "Kyoto",
      startDate: "2027-04-02",
      endDate: "2027-04-09",
    });
    await expect(
      pageA.getByRole("listitem").filter({ hasText: name }),
    ).toBeVisible();

    const listed = await pageA.request.get("/api/trips");
    expect(listed.status()).toBe(200);
    const body = (await listed.json()) as {
      trips: { id: string; title: string }[];
    };
    const trip = body.trips.find((item) => item.title === name);
    expect(trip?.id).toBeTruthy();

    contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await signInAsOtherTraveler(pageB);
    await expect(pageB.getByText(name)).toHaveCount(0);

    const hidden = await pageB.request.get(`/api/trips/${trip!.id}`);
    expect(hidden.status()).toBe(404);
    expect(await hidden.json()).toEqual({ error: "not_found" });

    const unknownPage = await pageB.goto("/trips/not-a-real-trip");
    expect(unknownPage?.status()).toBe(404);
    const unknownText = await pageB.locator("main").innerText();
    expect(unknownText).toContain("Trip not found");
    expect(unknownText).not.toContain(name);
    expect(unknownText).not.toContain("Kyoto");

    const hiddenPage = await pageB.goto(`/trips/${trip!.id}`);
    expect(hiddenPage?.status()).toBe(404);
    expect(await pageB.locator("main").innerText()).toBe(unknownText);

    const changed = await pageB.request.patch(`/api/trips/${trip!.id}`, {
      data: { title: "Stolen" },
    });
    expect(changed.status()).toBe(404);
    expect(await changed.json()).toEqual({ error: "not_found" });

    const listB = await pageB.request.get("/api/trips");
    const tripsB = (await listB.json()) as { trips: { title: string }[] };
    expect(tripsB.trips.some((item) => item.title === name)).toBe(false);
  } finally {
    await contextA?.close();
    await contextB?.close();
  }
});
