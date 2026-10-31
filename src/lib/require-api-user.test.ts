import { afterEach, expect, test, vi } from "vitest";

const { auth } = vi.hoisted(() => ({
  auth: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth,
}));

import { requireApiUser } from "./require-api-user";

afterEach(() => {
  vi.unstubAllEnvs();
  auth.mockReset();
});

test("requireApiUser returns 401 without calling Auth.js when auth is off", async () => {
  vi.stubEnv("AUTH_SECRET", "");
  vi.stubEnv("NODE_ENV", "production");

  const result = await requireApiUser();

  expect(auth).not.toHaveBeenCalled();
  expect(result).toBeInstanceOf(Response);
  expect((result as Response).status).toBe(401);
});

test("requireApiUser returns 401 when there is no session", async () => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("AUTH_SECRET", "present");
  vi.stubEnv("AUTH_TEST_LOGIN", "true");
  auth.mockResolvedValue(null);

  const result = await requireApiUser();

  expect(auth).toHaveBeenCalledOnce();
  expect(result).toBeInstanceOf(Response);
  expect((result as Response).status).toBe(401);
});

test("requireApiUser returns the signed-in user", async () => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("AUTH_SECRET", "present");
  vi.stubEnv("AUTH_TEST_LOGIN", "true");
  auth.mockResolvedValue({
    user: { id: "user-1", name: "Ada", email: "ada@example.com" },
  });

  await expect(requireApiUser()).resolves.toEqual({
    id: "user-1",
    name: "Ada",
    email: "ada@example.com",
  });
});
