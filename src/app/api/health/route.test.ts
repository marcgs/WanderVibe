import { expect, test } from "vitest";
import { GET } from "./route";

test("health endpoint returns 200", async () => {
  const response = GET();

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ status: "ok" });
});
