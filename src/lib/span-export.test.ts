import { expect, test } from "vitest";
import { propagation, ROOT_CONTEXT, TraceFlags } from "@opentelemetry/api";
import {
  createExportSpanProcessor,
  PLATFORM_PROBE_ATTRIBUTE,
  setPlatformProbeReleaser,
  type ExportSpan,
} from "./span-export";

function span(options: {
  name: string;
  traceId: string;
  attributes?: Record<string, unknown>;
  statusCode?: number;
  httpStatus?: number;
  bubble?: boolean;
}): ExportSpan & { flags: { traceId: string; traceFlags: number } } {
  const flags = { traceId: options.traceId, traceFlags: TraceFlags.SAMPLED };
  return {
    name: options.name,
    attributes: {
      ...options.attributes,
      ...(options.httpStatus === undefined
        ? {}
        : { "http.status_code": options.httpStatus }),
      ...(options.bubble ? { "next.bubble": true } : {}),
    },
    status: { code: options.statusCode ?? 0 },
    events: [],
    flags,
    spanContext: () => flags,
  };
}

function rememberProbe(
  processor: { onEnd(span: ExportSpan): void },
  traceId: string,
) {
  const middleware = span({
    name: "GET",
    traceId,
    httpStatus: 200,
    attributes: {
      "http.target": "/api/ready",
      "next.span_type": "BaseServer.handleRequest",
      [PLATFORM_PROBE_ATTRIBUTE]: "1",
    },
  });
  processor.onEnd(middleware);
  return middleware;
}

function spoofedBaggage() {
  const baggage = propagation.createBaggage({
    "wandervibe.platform_probe": { value: "1" },
  });
  return propagation.setBaggage(ROOT_CONTEXT, baggage);
}

function sampled(span: { flags: { traceFlags: number } }): boolean {
  return (span.flags.traceFlags & TraceFlags.SAMPLED) === TraceFlags.SAMPLED;
}

test("a manual readiness call exports the request and SELECT 1", () => {
  const released: ExportSpan[] = [];
  setPlatformProbeReleaser((item) => released.push(item));
  const processor = createExportSpanProcessor();
  const ready = span({
    name: "GET /api/ready",
    traceId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    httpStatus: 200,
    attributes: {
      "http.target": "/api/ready",
      "user_agent.original": "curl/8.5.0",
    },
  });
  const query = span({
    name: "pg.query:SELECT wandervibe",
    traceId: ready.flags.traceId,
    attributes: { "db.query.text": "SELECT 1" },
  });

  processor.onStart(ready);
  processor.onStart(query);
  processor.onEnd(query);
  processor.onEnd(ready);

  expect(sampled(ready)).toBe(true);
  expect(sampled(query)).toBe(true);
  expect(query.attributes?.["db.query.text"]).toBe("SELECT 1");
  expect(released).toEqual([]);
});

test("a successful platform probe drops the request, SELECT 1, and early spans", () => {
  const released: ExportSpan[] = [];
  setPlatformProbeReleaser((item) => released.push(item));
  const processor = createExportSpanProcessor();
  const traceId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const middleware = rememberProbe(processor, traceId);
  expect(sampled(middleware)).toBe(false);
  const prepare = span({ name: "prepare route module", traceId });
  const startResponse = span({ name: "start response", traceId });
  const query = span({
    name: "pg.query:SELECT wandervibe",
    traceId,
    attributes: { "db.query.text": "SELECT 1" },
  });
  const ready = span({
    name: "GET",
    traceId,
    httpStatus: 200,
    attributes: { "http.target": "/api/ready" },
  });

  processor.onStart(prepare);
  processor.onEnd(prepare);
  processor.onStart(startResponse);
  processor.onEnd(startResponse);
  processor.onStart(query);
  processor.onEnd(query);
  processor.onStart(ready);
  processor.onEnd(ready);

  expect(sampled(prepare)).toBe(false);
  expect(sampled(startResponse)).toBe(false);
  expect(sampled(query)).toBe(false);
  expect(sampled(ready)).toBe(false);
  expect(released).toEqual([]);
});

test("a failed platform probe keeps the request and releases SELECT 1", () => {
  const released: ExportSpan[] = [];
  setPlatformProbeReleaser((item) => released.push(item));
  const processor = createExportSpanProcessor();
  const traceId = "cccccccccccccccccccccccccccccccc";
  rememberProbe(processor, traceId);
  const prepare = span({ name: "prepare route module", traceId });
  const routeChild = span({
    name: "executing api route (app) /api/ready",
    traceId,
    attributes: {
      "next.route": "/api/ready",
      "next.span_type": "AppRouteRouteHandlers.runHandler",
    },
  });
  const query = span({
    name: "pg.query:SELECT wandervibe",
    traceId,
    attributes: { "db.query.text": "SELECT 1" },
  });
  const ready = span({
    name: "GET /api/ready",
    traceId,
    httpStatus: 503,
    attributes: { "http.target": "/api/ready" },
  });

  processor.onStart(prepare);
  processor.onEnd(prepare);
  processor.onEnd(routeChild);
  processor.onStart(query);
  processor.onEnd(query);
  processor.onStart(ready);
  processor.onEnd(ready);

  expect(sampled(ready)).toBe(true);
  expect(released).toHaveLength(3);
  expect(released[0]).toBe(prepare);
  expect(released[1]).toBe(routeChild);
  expect(released[2]).toBe(query);
  expect(prepare.flags.traceFlags & TraceFlags.SAMPLED).toBe(
    TraceFlags.SAMPLED,
  );
  expect(query.flags.traceFlags & TraceFlags.SAMPLED).toBe(TraceFlags.SAMPLED);
  expect(query.attributes?.["db.query.text"]).toBe("SELECT 1");

  const late = span({ name: "start response", traceId });
  processor.onEnd(late);
  expect(sampled(late)).toBe(true);
});

test("a kube-probe user agent on the span marks the trace without baggage", () => {
  const processor = createExportSpanProcessor();
  const traceId = "dddddddddddddddddddddddddddddddd";
  const ready = span({
    name: "GET /api/health",
    traceId,
    httpStatus: 200,
    attributes: { "user_agent.original": "kube-probe/1.25" },
  });
  const child = span({ name: "start response", traceId });

  processor.onStart(ready);
  processor.onStart(child);
  processor.onEnd(child);
  processor.onEnd(ready);

  expect(sampled(child)).toBe(false);
  expect(sampled(ready)).toBe(false);
});

test("the middleware probe span is dropped and does not close the trace", () => {
  const released: ExportSpan[] = [];
  setPlatformProbeReleaser((item) => released.push(item));
  const processor = createExportSpanProcessor();
  const traceId = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  rememberProbe(processor, traceId);
  const middleware = span({
    name: "GET",
    traceId,
    httpStatus: 200,
    attributes: {
      "http.target": "/api/ready",
      [PLATFORM_PROBE_ATTRIBUTE]: "1",
    },
  });
  const query = span({
    name: "pg.query:SELECT wandervibe",
    traceId,
    attributes: { "db.query.text": "SELECT 1" },
  });
  const ready = span({
    name: "GET /api/ready",
    traceId,
    httpStatus: 503,
    attributes: { "http.target": "/api/ready" },
  });

  processor.onStart(middleware);
  processor.onEnd(middleware);
  processor.onStart(query);
  processor.onEnd(query);
  processor.onStart(ready);
  processor.onEnd(ready);

  expect(sampled(middleware)).toBe(false);
  expect(sampled(ready)).toBe(true);
  expect(released).toContain(query);
  expect(query.flags.traceFlags & TraceFlags.SAMPLED).toBe(TraceFlags.SAMPLED);
});

test("next.bubble spans are not exported", () => {
  const processor = createExportSpanProcessor();
  const bubble = span({
    name: "GET",
    traceId: "ffffffffffffffffffffffffffffffff",
    httpStatus: 200,
    bubble: true,
    attributes: { "http.target": "/trips" },
  });

  processor.onEnd(bubble);

  expect(sampled(bubble)).toBe(false);
});

test("platform probe traces stay bounded when the request span never ends", () => {
  const processor = createExportSpanProcessor();
  const ids = Array.from({ length: 33 }, (_, index) =>
    (index + 1).toString(16).padStart(32, "0"),
  );

  for (const traceId of ids) rememberProbe(processor, traceId);

  const evicted = span({ name: "start response", traceId: ids[0] });
  const kept = span({ name: "start response", traceId: ids[32] });
  processor.onEnd(evicted);
  processor.onEnd(kept);

  expect(sampled(evicted)).toBe(true);
  expect(sampled(kept)).toBe(false);
});

test("a non-probe request with platform-probe baggage is still exported", () => {
  const processor = createExportSpanProcessor();
  const parent = spoofedBaggage();
  const page = span({
    name: "GET /signin",
    traceId: "12121212121212121212121212121212",
    httpStatus: 200,
    attributes: { "http.target": "/signin" },
  });
  const ready = span({
    name: "GET /api/ready",
    traceId: "13131313131313131313131313131313",
    httpStatus: 200,
    attributes: {
      "http.target": "/api/ready",
      baggage: "wandervibe.platform_probe=1",
    },
  });

  processor.onStart(page, parent);
  processor.onEnd(page);
  processor.onStart(ready, parent);
  processor.onEnd(ready);

  expect(sampled(page)).toBe(true);
  expect(sampled(ready)).toBe(true);
});

test("spoofed platform-probe baggage cannot fill the probe set", () => {
  const processor = createExportSpanProcessor();
  const parent = spoofedBaggage();
  const realId = "abababababababababababababababab";
  rememberProbe(processor, realId);

  for (let index = 0; index < 40; index += 1) {
    const traceId = (index + 1).toString(16).padStart(32, "b");
    const spoofed = span({
      name: index % 2 === 0 ? "GET /trips" : "GET /api/ready",
      traceId,
      httpStatus: 200,
      attributes: {
        "http.target": index % 2 === 0 ? "/trips" : "/api/ready",
        baggage: "wandervibe.platform_probe=1",
        "http.request.header.baggage": "wandervibe.platform_probe=1",
      },
    });
    processor.onStart(spoofed, parent);
    processor.onEnd(spoofed);
    expect(sampled(spoofed)).toBe(true);
  }

  const child = span({ name: "start response", traceId: realId });
  processor.onStart(child, parent);
  processor.onEnd(child);
  expect(sampled(child)).toBe(false);
});

test("a non-probe request reusing a probe trace is exported", () => {
  const released: ExportSpan[] = [];
  setPlatformProbeReleaser((item) => released.push(item));
  const processor = createExportSpanProcessor();
  const traceId = "16161616161616161616161616161616";
  rememberProbe(processor, traceId);
  const child = span({ name: "prepare route module", traceId });
  processor.onEnd(child);
  const signin = span({
    name: "GET /signin",
    traceId,
    httpStatus: 200,
    attributes: {
      "http.target": "/signin",
      "next.span_type": "BaseServer.handleRequest",
    },
  });
  processor.onEnd(signin);

  expect(sampled(signin)).toBe(true);
  expect(released).toContain(child);
  expect(sampled(child)).toBe(true);

  const later = span({
    name: "GET /signin",
    traceId,
    httpStatus: 200,
    attributes: { "http.target": "/signin" },
  });
  processor.onEnd(later);
  expect(sampled(later)).toBe(true);
});
