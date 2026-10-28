import { expect, test } from "@playwright/test";

test("ready endpoint reports a database round-trip", async ({ request }) => {
  const response = await request.get("/api/ready");

  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"] ?? "").toContain("no-store");
  await expect(response.json()).resolves.toEqual({ status: "ok" });
});
