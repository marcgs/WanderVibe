// @vitest-environment node

import { createRequire } from "node:module";
import { afterAll, expect, test } from "vitest";
import {
  _getSdkInstance,
  shutdownAzureMonitor,
} from "@azure/monitor-opentelemetry";
import { platformProbeReleaserInstalled } from "./span-export";
import { startTelemetry } from "./telemetry";

const require = createRequire(import.meta.url);

test("the prerender clock patch resolves and wraps the span processor", () => {
  expect(
    require.resolve("next/dist/server/app-render/work-unit-async-storage.external"),
  ).toContain("work-unit-async-storage.external");

  const connectionString =
    "InstrumentationKey=11111111-2222-4333-8444-555555555555;IngestionEndpoint=https://127.0.0.1:9";
  expect(
    startTelemetry({
      APPLICATIONINSIGHTS_CONNECTION_STRING: connectionString,
    }),
  ).toBe(true);

  const sdk = _getSdkInstance() as unknown as {
    _tracerProvider?: {
      _activeSpanProcessor?: {
        onEnd?: { wandervibePrerenderWrapped?: boolean };
      };
    };
  };
  expect(
    sdk._tracerProvider?._activeSpanProcessor?.onEnd
      ?.wandervibePrerenderWrapped,
  ).toBe(true);
  expect(platformProbeReleaserInstalled()).toBe(true);
}, 30_000);

afterAll(async () => {
  await shutdownAzureMonitor();
});
