import { trace, TraceFlags } from "@opentelemetry/api";
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

// Azure Container Apps Consumption probes are kubelet HTTP probes.
// kubelet sets User-Agent to kube-probe/<GitVersion>, for example kube-probe/1.25.
// The version changes with the platform, so only the prefix is significant.
// Dedicated workload profiles send curl/7.86.0 instead. This app uses Consumption.
// Matching curl would also drop the smoke test.
export const KUBE_PROBE_USER_AGENT = /^kube-probe\//i;

// Set on the middleware span, which ends with 200 before the route runs.
// That span is dropped and does not decide whether the trace is a failure.
// A client cannot set this. Incoming baggage is not a probe marker.
export const PLATFORM_PROBE_ATTRIBUTE = "wandervibe.platform_probe";

const MAX_PLATFORM_TRACES = 32;
const MAX_HELD_SPANS = 24;
const TRACE_ID = /^[0-9a-f]{32}$/i;

// Trace ids the proxy recorded after seeing a kube-probe User-Agent.
// Render spans do not carry that header, but they continue this trace.
// Client baggage cannot add an entry.
const notedPlatformProbes = new Set<string>();

export function notePlatformProbe(traceId: string | undefined): void {
  if (!traceId || !TRACE_ID.test(traceId) || /^0+$/.test(traceId)) return;
  if (notedPlatformProbes.has(traceId)) return;
  if (notedPlatformProbes.size >= MAX_PLATFORM_TRACES) {
    const oldest = notedPlatformProbes.keys().next().value;
    if (oldest !== undefined) notedPlatformProbes.delete(oldest);
  }
  notedPlatformProbes.add(traceId);
}

export function clearNotedPlatformProbes(): void {
  notedPlatformProbes.clear();
}

type HeldSpan = {
  span: ExportSpan;
  traceFlags: number;
};

type ProbeTrace = {
  held: HeldSpan[];
};

const releaseNothing: (span: ExportSpan) => void = () => {};

let releasePlatformProbeSpan: (span: ExportSpan) => void = releaseNothing;

// The batch processor already skipped these spans. On a failed probe the
// telemetry startup calls this with that processor so SELECT 1 is exported.
export function setPlatformProbeReleaser(
  release: (span: ExportSpan) => void,
): void {
  releasePlatformProbeSpan = release;
}

export function platformProbeReleaserInstalled(): boolean {
  return releasePlatformProbeSpan !== releaseNothing;
}

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

export function activeSpanIsPlatformProbe(): boolean {
  const active = trace.getActiveSpan() as
    | {
        attributes?: Record<string, unknown>;
        spanContext(): { traceId: string };
      }
    | undefined;
  if (!active) return false;
  if (active.attributes?.[PLATFORM_PROBE_ATTRIBUTE] === "1") return true;
  return notedPlatformProbes.has(active.spanContext().traceId);
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
  const spanContext = span.spanContext?.();
  if (!spanContext) return;
  spanContext.traceFlags &= ~TraceFlags.SAMPLED;
}

function spanUserAgent(span: ExportSpan): string | undefined {
  const attributes = span.attributes ?? {};
  for (const key of [
    "user_agent.original",
    "http.user_agent",
    "http.request.header.user-agent",
  ]) {
    const value = attributes[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function marksPlatformProbe(span: ExportSpan): boolean {
  const traceId = span.spanContext?.()?.traceId;
  if (traceId && notedPlatformProbes.has(traceId)) return true;
  if (span.attributes?.[PLATFORM_PROBE_ATTRIBUTE] === "1") return true;
  const userAgent = spanUserAgent(span);
  return Boolean(
    userAgent && KUBE_PROBE_USER_AGENT.test(userAgent) && probePath(span),
  );
}

// Runs before the distro's batch processor. Only a platform probe is dropped.
// A manual or smoke-test call keeps the request and the SELECT 1 dependency.
// Child spans, including prepare route module and start response, end before
// the request status is known, so they are held and exported only on failure.
export function createExportSpanProcessor(): {
  onStart(span: ExportSpan, parentContext?: unknown): void;
  onEnd(span: ExportSpan): void;
  shutdown(): Promise<void>;
  forceFlush(): Promise<void>;
} {
  const probeTraces = new Map<string, ProbeTrace>();

  function remember(traceId: string): void {
    if (probeTraces.has(traceId)) return;
    if (probeTraces.size >= MAX_PLATFORM_TRACES) {
      const oldest = probeTraces.keys().next().value;
      if (oldest !== undefined) probeTraces.delete(oldest);
    }
    probeTraces.set(traceId, { held: [] });
  }

  function hold(trace: ProbeTrace, span: ExportSpan): void {
    const spanContext = span.spanContext?.();
    if (!spanContext) return;
    const traceFlags = spanContext.traceFlags;
    unsample(span);
    if (trace.held.length >= MAX_HELD_SPANS) return;
    trace.held.push({ span, traceFlags });
  }

  function release(trace: ProbeTrace): void {
    for (const held of trace.held) {
      const spanContext = held.span.spanContext?.();
      if (spanContext) spanContext.traceFlags = held.traceFlags;
      releasePlatformProbeSpan(held.span);
    }
  }

  return {
    onStart(span) {
      const spanContext = span.spanContext?.();
      if (!spanContext) return;
      if (!marksPlatformProbe(span)) return;
      remember(spanContext.traceId);
    },
    onEnd(span) {
      redactExportedSpan(span);
      if (span.attributes?.["next.bubble"] === true) {
        unsample(span);
        return;
      }
      // The middleware pass ends 200 before the route handler runs.
      if (span.attributes?.[PLATFORM_PROBE_ATTRIBUTE] === "1") {
        unsample(span);
        return;
      }
      const spanContext = span.spanContext?.();
      if (!spanContext) return;
      const trace = probeTraces.get(spanContext.traceId);
      if (!trace) return;
      const path = probePath(span);
      if (!path) {
        hold(trace, span);
        return;
      }
      // The request span ends last. Drop the id on both outcomes so a down
      // database cannot grow the set by one failed probe at a time.
      probeTraces.delete(spanContext.traceId);
      notedPlatformProbes.delete(spanContext.traceId);
      if (isProbeFailure(span)) {
        release(trace);
        return;
      }
      unsample(span);
    },
    shutdown() {
      probeTraces.clear();
      return Promise.resolve();
    },
    forceFlush() {
      return Promise.resolve();
    },
  };
}
