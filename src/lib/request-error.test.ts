import { trace } from "@opentelemetry/api";
import { afterEach, expect, test, vi } from "vitest";
import { logger } from "./logger";
import {
  exceptionForTelemetry,
  reportRequestError,
  requestErrorFields,
} from "./request-error";

afterEach(() => {
  vi.restoreAllMocks();
});

test("telemetry exceptions drop emails, passwords, and tokens", () => {
  const error = new Error(
    "sign-in failed for marc@example.com password=hunter2-password token=session-token-value",
  );
  error.stack = `${error.stack}\nemail marc@example.com`;

  const reported = exceptionForTelemetry(error);

  expect(reported.name).toBe("Error");
  expect(reported.message).not.toContain("marc@example.com");
  expect(reported.message).not.toContain("hunter2-password");
  expect(reported.message).not.toContain("session-token-value");
  expect(reported.stack).not.toContain("marc@example.com");
  expect(reported.message).toContain("sign-in failed");
});

test("request error fields do not copy session cookies or authorization", () => {
  const fields = requestErrorFields(
    {
      path: "/api/trips",
      method: "POST",
      headers: {
        cookie: "authjs.session-token=cookie-secret-value",
        authorization: "Bearer bearer-secret-value",
        "x-request-id": "11111111-1111-4111-8111-111111111111",
      },
    },
    { routePath: "/api/trips" },
  );

  expect(fields).toEqual({
    requestId: "11111111-1111-4111-8111-111111111111",
    method: "POST",
    path: "/api/trips",
    route: "/api/trips",
  });
  expect(JSON.stringify(fields)).not.toContain("cookie-secret-value");
  expect(JSON.stringify(fields)).not.toContain("bearer-secret-value");
});

test("reportRequestError records a scrubbed exception and ignores headers", () => {
  const recordException = vi.fn();
  const setStatus = vi.fn();
  const setAttribute = vi.fn();
  const end = vi.fn();
  vi.spyOn(logger, "error").mockImplementation(() => {});
  vi.spyOn(trace, "getTracer").mockReturnValue({
    startSpan: () => ({
      recordException,
      setStatus,
      setAttribute,
      end,
    }),
  } as never);

  reportRequestError(
    new Error("failed for marc@example.com password=hunter2-password"),
    {
      path: "/api/trips?code=oauth-code-value",
      method: "POST",
      headers: {
        cookie: "authjs.session-token=cookie-secret-value",
        authorization: "Bearer bearer-secret-value",
      },
    },
    { routePath: "/api/trips" },
  );

  expect(end).toHaveBeenCalledOnce();
  const recorded = recordException.mock.calls[0]?.[0] as Error;
  expect(recorded.message).not.toContain("marc@example.com");
  expect(recorded.message).not.toContain("hunter2-password");
  const attributes = setAttribute.mock.calls.flat().join(" ");
  expect(attributes).not.toContain("cookie-secret-value");
  expect(attributes).not.toContain("bearer-secret-value");
  expect(attributes).toContain("/api/trips");
  expect(setStatus.mock.calls[0]?.[0].message).not.toContain(
    "marc@example.com",
  );
});
