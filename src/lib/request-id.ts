import { trace } from "@opentelemetry/api";

// UUIDs and W3C trace ids only. A session token or an email in x-request-id
// is ignored so it cannot be copied into a log line.
const SAFE_REQUEST_ID =
  /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

export function acceptRequestId(
  value: string | null | undefined,
): string | undefined {
  const trimmed = value?.trim() ?? "";
  if (!SAFE_REQUEST_ID.test(trimmed)) return undefined;
  if (/^0+$/.test(trimmed)) return undefined;
  return trimmed;
}

function activeTraceId(): string | undefined {
  const traceId = trace.getActiveSpan()?.spanContext().traceId;
  return acceptRequestId(traceId);
}

export function requestIdFrom(headers?: {
  get(name: string): string | null;
}): string {
  return (
    acceptRequestId(headers?.get("x-request-id")) ??
    activeTraceId() ??
    crypto.randomUUID()
  );
}

export function requestIdFromRecord(
  headers: Record<string, string | string[] | undefined>,
): string {
  const raw = headers["x-request-id"] ?? headers["X-Request-Id"];
  const incoming = Array.isArray(raw) ? raw[0] : raw;
  return acceptRequestId(incoming) ?? activeTraceId() ?? crypto.randomUUID();
}
