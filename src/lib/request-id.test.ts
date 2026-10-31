import { expect, test } from "vitest";
import { acceptRequestId, requestIdFrom, runWithRequestId } from "./request-id";

test("request ids accept a uuid or a trace id and ignore secrets", () => {
  const uuid = "11111111-1111-4111-8111-111111111111";
  const traceId = "0123456789abcdef0123456789abcdef";

  expect(acceptRequestId(uuid)).toBe(uuid);
  expect(acceptRequestId(traceId)).toBe(traceId);
  expect(acceptRequestId("marc@example.com")).toBeUndefined();
  expect(acceptRequestId("Bearer session-token-value")).toBeUndefined();
  expect(acceptRequestId("session-token-value")).toBeUndefined();
  expect(
    acceptRequestId("eyJhbGciOiJIUzI1NiJ9.payload.signature"),
  ).toBeUndefined();
  expect(acceptRequestId("00000000000000000000000000000000")).toBeUndefined();
});

test("a secret in x-request-id is replaced", () => {
  const headers = new Headers({
    "x-request-id": "marc@example.com",
  });

  const requestId = requestIdFrom(headers);

  expect(requestId).not.toContain("@");
  expect(requestId).not.toContain("marc");
  expect(requestId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
});

test("logs in one request share an id when telemetry is off", () => {
  const seen: string[] = [];
  runWithRequestId("11111111-1111-4111-8111-111111111111", () => {
    seen.push(requestIdFrom());
    seen.push(requestIdFrom());
  });

  expect(seen).toEqual([
    "11111111-1111-4111-8111-111111111111",
    "11111111-1111-4111-8111-111111111111",
  ]);
});
