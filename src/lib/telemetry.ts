import { createRequire } from "node:module";
import {
  useAzureMonitor as startAzureMonitor,
  _getSdkInstance,
} from "@azure/monitor-opentelemetry";
import type { AzureMonitorOpenTelemetryOptions } from "@azure/monitor-opentelemetry";
import { logger } from "@/lib/logger";
import {
  createExportSpanProcessor,
  setPlatformProbeReleaser,
} from "@/lib/span-export";

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
  return createExportSpanProcessor();
}

const PRERENDER_PATCH_WARNING =
  "Telemetry could not keep the prerender clock stable";

function warnPrerenderPatch(): void {
  try {
    logger.warn(PRERENDER_PATCH_WARNING);
  } catch {
    // A logging failure must not stop startup. Probes still have to pass.
  }
}

// Cache Components aborts a prerender when Date.now() runs inside it. Ending a
// span records a histogram, and that calls Date.now() while the prerender
// store is still active. Leave the store for the whole processor chain.
// The batch processor is last. A failed platform probe calls it again so a
// dependency that ended before the request status was known is still exported.
function keepPrerenderClockStable(): void {
  try {
    const require = createRequire(import.meta.url);
    const storage =
      require("next/dist/server/app-render/work-unit-async-storage.external") as {
        workUnitAsyncStorage: { exit: <T>(fn: () => T) => T };
      };
    const sdk = _getSdkInstance() as
      | {
          _tracerProvider?: {
            _activeSpanProcessor?: {
              onStart: (span: unknown, context: unknown) => void;
              onEnd: (span: unknown) => void;
              _spanProcessors?: { onEnd?: (span: unknown) => void }[];
            };
          };
        }
      | undefined;
    const processor = sdk?._tracerProvider?._activeSpanProcessor;
    const batch = processor?._spanProcessors?.at(-1);
    if (!processor?.onStart || !processor.onEnd || !batch?.onEnd) {
      warnPrerenderPatch();
      return;
    }
    setPlatformProbeReleaser((span) => batch.onEnd?.(span));
    const exit = storage.workUnitAsyncStorage.exit.bind(
      storage.workUnitAsyncStorage,
    );
    const onStart = processor.onStart.bind(processor);
    const onEnd = processor.onEnd.bind(processor);
    const wrappedOnEnd = Object.assign(
      (span: unknown) => exit(() => onEnd(span)),
      { wandervibePrerenderWrapped: true },
    );
    processor.onStart = (span, parentContext) =>
      exit(() => onStart(span, parentContext));
    processor.onEnd = wrappedOnEnd;
  } catch {
    warnPrerenderPatch();
  }
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
    // The distro's default rate limit drops the first spans.
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
    keepPrerenderClockStable();
    started = true;
    return true;
  } catch {
    logger.error("Telemetry did not start");
    return false;
  }
}
