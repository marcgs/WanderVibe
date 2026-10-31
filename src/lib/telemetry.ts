import { useAzureMonitor as startAzureMonitor } from "@azure/monitor-opentelemetry";
import type { AzureMonitorOpenTelemetryOptions } from "@azure/monitor-opentelemetry";
import { logger } from "@/lib/logger";
import { redactExportedSpan } from "@/lib/redact";

type SpanProcessor = NonNullable<
  AzureMonitorOpenTelemetryOptions["spanProcessors"]
>[number];

type TelemetryEnv = {
  APPLICATIONINSIGHTS_CONNECTION_STRING?: string;
};

let started = false;

export function resetTelemetryForTests(): void {
  started = false;
}

function redactingSpanProcessor(): SpanProcessor {
  return {
    onStart() {
      return undefined;
    },
    onEnd(span) {
      redactExportedSpan(span);
    },
    shutdown() {
      return Promise.resolve();
    },
    forceFlush() {
      return Promise.resolve();
    },
  };
}

export function telemetryOptions(
  connectionString: string,
): AzureMonitorOpenTelemetryOptions {
  return {
    azureMonitorExporterOptions: {
      connectionString,
      // Failed batches stay in memory. The container disk does not keep them.
      disableOfflineStorage: true,
    },
    // The distro's default rate limit drops the first spans. A personal app
    // keeps every trace, which stays inside the 0.2 GB daily cap.
    samplingRatio: 1,
    tracesPerSecond: 0,
    // Live Metrics opens another channel and is not part of this story.
    enableLiveMetrics: false,
    // The browser snippet would add frontend telemetry, which is out of scope.
    browserSdkLoaderOptions: { enabled: false },
    instrumentationOptions: {
      http: { enabled: true },
      postgreSql: { enabled: true },
      azureSdk: { enabled: false },
      mongoDb: { enabled: false },
      mySql: { enabled: false },
      redis: { enabled: false },
      redis4: { enabled: false },
      bunyan: { enabled: false },
      winston: { enabled: false },
      console: { enabled: false },
    },
    // Runs before the Azure batch exporter, so the exporter sees scrubbed attributes.
    spanProcessors: [redactingSpanProcessor()],
  };
}

// Called from instrumentation.ts only when the connection string is non-empty.
// A throw here must not stop the process: probes still have to pass.
export function startTelemetry(env?: TelemetryEnv): boolean {
  if (started) return true;
  const source = env ?? process.env;
  const connectionString = source.APPLICATIONINSIGHTS_CONNECTION_STRING?.trim();
  if (!connectionString) return false;
  if (!process.env.OTEL_SERVICE_NAME?.trim()) {
    process.env.OTEL_SERVICE_NAME = "wandervibe";
  }
  try {
    startAzureMonitor(telemetryOptions(connectionString));
    started = true;
    return true;
  } catch {
    logger.error("Telemetry did not start");
    return false;
  }
}
