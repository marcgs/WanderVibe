import { connection } from "next/server";
import { beforeEach, expect, test, vi } from "vitest";

const { createTestSession, isTestLoginEnabled } = vi.hoisted(() => ({
  createTestSession: vi.fn(),
  isTestLoginEnabled: vi.fn(),
}));

vi.mock("next/server", () => ({
  connection: vi.fn(async () => undefined),
}));

vi.mock("@/lib/create-test-session", () => ({
  createTestSession,
}));

vi.mock("@/lib/test-login", () => ({
  isTestLoginEnabled,
}));

import { POST } from "./route";

beforeEach(() => {
  createTestSession.mockReset();
  isTestLoginEnabled.mockReset();
  vi.mocked(connection).mockClear();
});

test("test sign-in is not found when the path is disabled", async () => {
  isTestLoginEnabled.mockReturnValue(false);

  const response = await POST();

  expect(connection).toHaveBeenCalledOnce();
  expect(response.status).toBe(404);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(createTestSession).not.toHaveBeenCalled();
});

test("test sign-in creates a session when the path is enabled", async () => {
  isTestLoginEnabled.mockReturnValue(true);
  createTestSession.mockResolvedValue(undefined);

  const response = await POST();

  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  await expect(response.json()).resolves.toEqual({ ok: true });
  expect(createTestSession).toHaveBeenCalledOnce();
});
