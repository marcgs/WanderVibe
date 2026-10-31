import { AsyncLocalStorage } from "node:async_hooks";
import { trace } from "@opentelemetry/api";

const requestIds = new AsyncLocalStorage<string>();
const forwardedHeaders = new AsyncLocalStorage<RequestStore>();
const generatedForRequest = new WeakMap<object, string>();

type RequestStore = {
  type?: string;
  headers?: { get(name: string): string | null };
};

export function runWithForwardedHeaders<T>(
  headers: { get(name: string): string | null },
  fn: () => T,
): T {
  const store: RequestStore = { type: "request", headers };
  return forwardedHeaders.run(store, fn);
}

function currentRequestStore(): RequestStore | undefined {
  const forwarded = forwardedHeaders.getStore();
  if (forwarded) return forwarded;
  if (process.env.NEXT_RUNTIME === "edge") return undefined;
  try {
    const builtin = (
      process as NodeJS.Process & {
        getBuiltinModule?: (name: string) => {
          createRequire: (url: string) => (id: string) => {
            workUnitAsyncStorage: { getStore(): RequestStore | undefined };
          };
        };
      }
    ).getBuiltinModule?.("node:module");
    if (!builtin) return undefined;
    const store = builtin
      .createRequire(import.meta.url)(
        "next/dist/server/app-render/work-unit-async-storage.external",
      )
      .workUnitAsyncStorage.getStore();
    if (!store || store.type !== "request") return undefined;
    return store;
  } catch {
    return undefined;
  }
}

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

export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return requestIds.run(requestId, fn);
}

export function requestIdFor(headers?: {
  get(name: string): string | null;
}): string {
  return acceptRequestId(headers?.get("x-request-id")) ?? crypto.randomUUID();
}

function perRequestId(store: object | undefined): string {
  if (!store) return crypto.randomUUID();
  const existing = generatedForRequest.get(store);
  if (existing) return existing;
  const created = crypto.randomUUID();
  generatedForRequest.set(store, created);
  return created;
}

// A forwarded x-request-id wins, then the active trace id, then one id for
// this request. Route handlers do not see the proxy's async store.
export function requestIdFrom(headers?: {
  get(name: string): string | null;
}): string {
  const store = currentRequestStore();
  return (
    acceptRequestId(headers?.get("x-request-id")) ??
    acceptRequestId(store?.headers?.get("x-request-id")) ??
    activeTraceId() ??
    requestIds.getStore() ??
    perRequestId(store)
  );
}

export function requestIdFromRecord(
  headers: Record<string, string | string[] | undefined>,
): string {
  const raw = headers["x-request-id"] ?? headers["X-Request-Id"];
  const incoming = Array.isArray(raw) ? raw[0] : raw;
  return (
    acceptRequestId(incoming) ??
    activeTraceId() ??
    requestIds.getStore() ??
    crypto.randomUUID()
  );
}
