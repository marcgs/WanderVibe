// @vitest-environment node

import { afterEach, beforeEach, expect, test, vi } from "vitest";

const { useAzureMonitor, error } = vi.hoisted(() => ({
  useAzureMonitor: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@azure/monitor-opentelemetry", () => ({
  useAzureMonitor,
}));

vi.mock("@/lib/logger", () => ({
  logger: { error },
}));

import {
  resetTelemetryForTests,
  startTelemetry,
  telemetryOptions,
} from "./telemetry";

const previousServiceName = process.env.OTEL_SERVICE_NAME;

beforeEach(() => {
  resetTelemetryForTests();
  useAzureMonitor.mockReset();
  error.mockReset();
  delete process.env.OTEL_SERVICE_NAME;
});

afterEach(() => {
  if (previousServiceName === undefined) delete process.env.OTEL_SERVICE_NAME;
  else process.env.OTEL_SERVICE_NAME = previousServiceName;
});

test("telemetry stays off when the connection string is missing", () => {
  expect(startTelemetry({})).toBe(false);
  expect(startTelemetry({ APPLICATIONINSIGHTS_CONNECTION_STRING: "   " })).toBe(
    false,
  );
  expect(useAzureMonitor).not.toHaveBeenCalled();
});

test("a startup failure does not log the connection string or throw", () => {
  const connectionString =
    "InstrumentationKey=instrumentation-key-value;IngestionEndpoint=https://eastus.example";
  useAzureMonitor.mockImplementation(() => {
    throw new Error(`refusing ${connectionString}`);
  });

  expect(
    startTelemetry({
      APPLICATIONINSIGHTS_CONNECTION_STRING: connectionString,
    }),
  ).toBe(false);

  const logged = JSON.stringify(error.mock.calls);
  expect(logged).toContain("Telemetry did not start");
  expect(logged).not.toContain("instrumentation-key-value");
  expect(logged).not.toContain("IngestionEndpoint");
  expect(useAzureMonitor).toHaveBeenCalledOnce();
});

test("telemetry starts once and exports http, postgres, and scrubbed spans", () => {
  const connectionString = "InstrumentationKey=instrumentation-key-value";

  expect(
    startTelemetry({
      APPLICATIONINSIGHTS_CONNECTION_STRING: `  ${connectionString}  `,
    }),
  ).toBe(true);
  expect(
    startTelemetry({
      APPLICATIONINSIGHTS_CONNECTION_STRING: connectionString,
    }),
  ).toBe(true);

  expect(useAzureMonitor).toHaveBeenCalledOnce();
  expect(process.env.OTEL_SERVICE_NAME).toBe("wandervibe");
  const options = useAzureMonitor.mock.calls[0]?.[0] as ReturnType<
    typeof telemetryOptions
  >;
  expect(options.azureMonitorExporterOptions?.connectionString).toBe(
    connectionString,
  );
  expect(options.samplingRatio).toBe(1);
  expect(options.tracesPerSecond).toBe(0);
  expect(options.enableLiveMetrics).toBe(false);
  expect(options.browserSdkLoaderOptions?.enabled).toBe(false);
  expect(options.instrumentationOptions?.http?.enabled).toBe(true);
  expect(options.instrumentationOptions?.postgreSql?.enabled).toBe(true);
  expect(options.instrumentationOptions?.console?.enabled).toBe(false);
  expect(options.azureMonitorExporterOptions?.disableOfflineStorage).toBe(true);

  const span = {
    name: "GET /api/ready",
    attributes: {
      "db.query.text": "SELECT 1",
      "user.email": "marc@example.com",
      password: "hunter2-password",
    },
    events: [],
    status: { message: "token=session-token-value" },
  };
  options.spanProcessors?.[0]?.onEnd(span as never);
  const encoded = JSON.stringify(span);
  expect(span.attributes["db.query.text"]).toBe("SELECT 1");
  expect(encoded).not.toContain("marc@example.com");
  expect(encoded).not.toContain("hunter2-password");
  expect(encoded).not.toContain("session-token-value");
});
