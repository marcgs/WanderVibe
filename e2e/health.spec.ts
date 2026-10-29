import { expect, test } from "@playwright/test";

test("health endpoint returns ok without a session", async ({ request }) => {
  const response = await request.get("/api/health", { maxRedirects: 0 });

  expect(response.status()).toBe(200);
  expect(response.headers().location).toBeUndefined();
  expect(response.headers()["cache-control"] ?? "").toContain("no-store");
  await expect(response.json()).resolves.toEqual({ status: "ok" });
});
