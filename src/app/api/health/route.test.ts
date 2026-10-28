import { connection } from "next/server";
import { expect, test, vi } from "vitest";
import { GET } from "./route";

vi.mock("next/server", () => ({
  connection: vi.fn(async () => undefined),
}));

test("health endpoint returns 200 and is not cached", async () => {
  const response = await GET();

  expect(connection).toHaveBeenCalledTimes(1);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  await expect(response.json()).resolves.toEqual({ status: "ok" });
});
