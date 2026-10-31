// @vitest-environment node

import { expect, test, vi } from "vitest";
import { NextRequest, type NextFetchEvent } from "next/server";

vi.mock("@/auth", () => ({
  auth: (handler: unknown) => handler,
}));

import { proxy } from "@/proxy";

const requestId = "11111111-1111-4111-8111-111111111111";

function event(): NextFetchEvent {
  return {} as NextFetchEvent;
}

test("forwards x-request-id on the downstream request", async () => {
  const request = new NextRequest("http://localhost/api/health", {
    headers: { "x-request-id": requestId, "user-agent": "curl/8.5.0" },
  });

  const response = await proxy(request, event());

  expect(response.headers.get("x-middleware-request-x-request-id")).toBe(
    requestId,
  );
  expect(response.headers.get("x-middleware-override-headers")).toContain(
    "x-request-id",
  );
  expect(response.headers.get("x-middleware-request-baggage")).toBeNull();
});

test("marks only a kube-probe call to a probe path", async () => {
  const probe = new NextRequest("http://localhost/api/ready", {
    headers: {
      "x-request-id": requestId,
      "user-agent": "kube-probe/1.25",
      accept: "*/*",
    },
  });

  const response = await proxy(probe, event());

  expect(response.headers.get("x-middleware-request-x-request-id")).toBe(
    requestId,
  );
  expect(response.headers.get("x-middleware-request-user-agent")).toBe(
    "kube-probe/1.25",
  );
  expect(response.headers.get("x-middleware-request-baggage")).toBe(
    "wandervibe.platform_probe=1",
  );
  expect(response.headers.get("x-middleware-override-headers")).toContain(
    "user-agent",
  );

  const manual = new NextRequest("http://localhost/api/ready", {
    headers: { "user-agent": "curl/8.5.0", "x-request-id": requestId },
  });
  const manualResponse = await proxy(manual, event());
  expect(manualResponse.headers.get("x-middleware-request-baggage")).toBeNull();

  const page = new NextRequest("http://localhost/signin", {
    headers: { "user-agent": "kube-probe/1.25", "x-request-id": requestId },
  });
  const pageResponse = await proxy(page, event());
  expect(pageResponse.headers.get("x-middleware-request-baggage")).toBeNull();
});
