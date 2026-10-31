import { TraceFlags } from "@opentelemetry/api";
import { redactExportedSpan } from "@/lib/redact";

type SpanContextLike = {
  traceId: string;
  traceFlags: number;
};

type ParentContextLike = {
  traceId?: string;
};

export type ExportSpan = {
  name?: string;
  attributes?: Record<string, unknown>;
  status?: { code?: number; message?: string };
  events?: { attributes?: Record<string, unknown> }[];
  parentSpanContext?: ParentContextLike;
  spanContext?: () => SpanContextLike;
};

// Next records the request. The distro's HTTP instrumentation does not, in
// the standalone server. Probe paths show up on the Next span name or target.
export function probePath(span: {
  name?: string;
  attributes?: Record<string, unknown>;
}): "/api/health" | "/api/ready" | undefined {
  const attributes = span.attributes ?? {};
  const candidates = [
    attributes["http.target"],
    attributes["url.path"],
    attributes["http.route"],
    attributes["next.route"],
    span.name,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const path = candidate
      .replace(/^[A-Z]+\s+/, "")
      .split("?")[0]
      ?.trim();
    if (path === "/api/health" || path === "/api/ready") return path;
  }
  return undefined;
}

function statusCode(span: ExportSpan): number | undefined {
  const attributes = span.attributes ?? {};
  const raw =
    attributes["http.status_code"] ?? attributes["http.response.status_code"];
  const code = typeof raw === "string" ? Number(raw) : raw;
  return typeof code === "number" && Number.isFinite(code) ? code : undefined;
}

export function isProbeFailure(span: ExportSpan): boolean {
  if (span.status?.code === 2) return true;
  const code = statusCode(span);
  return code !== undefined && code >= 400;
}

function unsample(span: ExportSpan): void {
  const context = span.spanContext?.();
  if (!context) return;
  context.traceFlags &= ~TraceFlags.SAMPLED;
}

// Runs before the distro's batch processor. Successful probe traces are
// unsampled so they are not exported. A failed probe span stays sampled.
// Child spans end first, before the status is known, so they are dropped;
// the failed request span and the readiness log remain.
export function createExportSpanProcessor(): {
  onStart(span: ExportSpan): void;
  onEnd(span: ExportSpan): void;
  shutdown(): Promise<void>;
  forceFlush(): Promise<void>;
} {
  const probeTraces = new Set<string>();

  return {
    onStart(span) {
      const context = span.spanContext?.();
      if (!context || !probePath(span)) return;
      probeTraces.add(context.traceId);
    },
    onEnd(span) {
      redactExportedSpan(span);
      if (span.attributes?.["next.bubble"] === true) {
        unsample(span);
      }
      const context = span.spanContext?.();
      if (!context) return;
      const path = probePath(span);
      if (path) probeTraces.add(context.traceId);
      if (!probeTraces.has(context.traceId)) return;
      if (path && isProbeFailure(span)) return;
      unsample(span);
      if (path && !isProbeFailure(span)) probeTraces.delete(context.traceId);
    },
    shutdown() {
      return Promise.resolve();
    },
    forceFlush() {
      return Promise.resolve();
    },
  };
}
