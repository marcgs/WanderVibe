import { expect, test } from "@playwright/test";

test("sign in, open a protected page, and sign out", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/signin$/);

  await page.getByRole("button", { name: "Sign in as test traveler" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "WanderVibe" })).toBeVisible();
  await expect(page.getByText("Signed in as Test Traveler")).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/signin$/);

  await page.goto("/");
  await expect(page).toHaveURL(/\/signin$/);
});

test("an unsigned page redirects and an unsigned API returns 401", async ({
  request,
}) => {
  const page = await request.get("/", { maxRedirects: 0 });
  expect(page.status()).toBe(307);
  expect(page.headers().location).toContain("/signin");

  const api = await request.get("/api/trips", { maxRedirects: 0 });
  expect(api.status()).toBe(401);
  expect(api.headers().location).toBeUndefined();
  await expect(api.json()).resolves.toEqual({ error: "unauthorized" });

  const tripPage = await request.get("/trips/c000000000000000000000000", {
    maxRedirects: 0,
  });
  expect(tripPage.status()).toBe(307);
  expect(tripPage.headers().location).toContain("/signin");

  const tripApi = await request.get("/api/trips/c000000000000000000000000", {
    maxRedirects: 0,
  });
  expect(tripApi.status()).toBe(401);
  expect(tripApi.headers().location).toBeUndefined();
  await expect(tripApi.json()).resolves.toEqual({ error: "unauthorized" });
});
