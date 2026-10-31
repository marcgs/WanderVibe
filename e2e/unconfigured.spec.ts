import { expect, test } from "@playwright/test";

test("probes stay up and the app fails closed when auth is not configured", async ({
  request,
}) => {
  const health = await request.get("/api/health", { maxRedirects: 0 });
  expect(health.status()).toBe(200);
  expect(health.headers().location).toBeUndefined();
  await expect(health.json()).resolves.toEqual({ status: "ok" });

  const ready = await request.get("/api/ready", { maxRedirects: 0 });
  expect(ready.status()).toBe(200);
  expect(ready.headers().location).toBeUndefined();
  await expect(ready.json()).resolves.toEqual({ status: "ok" });

  const page = await request.get("/", { maxRedirects: 0 });
  const body = await page.text();
  expect(page.status()).toBe(200);
  expect(page.headers().location).toBeUndefined();
  expect(page.headers()["content-type"]).toContain("text/plain");
  expect(body).toContain("Sign-in is not configured yet");
  expect(body).not.toContain("WanderVibe");

  const api = await request.get("/api/trips", { maxRedirects: 0 });
  expect(api.status()).toBe(401);
  expect(api.headers().location).toBeUndefined();
  await expect(api.json()).resolves.toEqual({ error: "unauthorized" });

  const tripPage = await request.get("/trips/c000000000000000000000000", {
    maxRedirects: 0,
  });
  const tripBody = await tripPage.text();
  expect(tripPage.status()).toBe(200);
  expect(tripPage.headers().location).toBeUndefined();
  expect(tripPage.headers()["content-type"]).toContain("text/plain");
  expect(tripBody).toContain("Sign-in is not configured yet");
  expect(tripBody).not.toContain("WanderVibe");

  const tripApi = await request.get("/api/trips/c000000000000000000000000", {
    maxRedirects: 0,
  });
  expect(tripApi.status()).toBe(401);
  expect(tripApi.headers().location).toBeUndefined();
  await expect(tripApi.json()).resolves.toEqual({ error: "unauthorized" });
});
