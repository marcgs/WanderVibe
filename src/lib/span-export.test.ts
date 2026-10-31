import { expect, test } from "vitest";
import { propagation, ROOT_CONTEXT, TraceFlags } from "@opentelemetry/api";
import {
  createExportSpanProcessor,
  PLATFORM_PROBE_ATTRIBUTE,
  PLATFORM_PROBE_BAGGAGE,
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

function platformContext() {
  const baggage = propagation.createBaggage({
    [PLATFORM_PROBE_BAGGAGE]: { value: "1" },
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
  const parent = platformContext();
  const traceId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
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

  processor.onStart(prepare, parent);
  processor.onEnd(prepare);
  processor.onStart(startResponse, parent);
  processor.onEnd(startResponse);
  processor.onStart(query, parent);
  processor.onEnd(query);
  processor.onStart(ready, parent);
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
  const parent = platformContext();
  const traceId = "cccccccccccccccccccccccccccccccc";
  const prepare = span({ name: "prepare route module", traceId });
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

  processor.onStart(prepare, parent);
  processor.onEnd(prepare);
  processor.onStart(query, parent);
  processor.onEnd(query);
  processor.onStart(ready, parent);
  processor.onEnd(ready);

  expect(sampled(ready)).toBe(true);
  expect(released).toHaveLength(2);
  expect(released[0]).toBe(prepare);
  expect(released[1]).toBe(query);
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
  const parent = platformContext();
  const traceId = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
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

  processor.onStart(middleware, parent);
  processor.onEnd(middleware);
  processor.onStart(query, parent);
  processor.onEnd(query);
  processor.onStart(ready, parent);
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
  const parent = platformContext();
  const ids = Array.from({ length: 33 }, (_, index) =>
    index.toString(16).padStart(32, "0"),
  );

  for (const traceId of ids) {
    processor.onStart(span({ name: "GET /api/ready", traceId }), parent);
  }

  const evicted = span({ name: "start response", traceId: ids[0] });
  const kept = span({ name: "start response", traceId: ids[32] });
  processor.onEnd(evicted);
  processor.onEnd(kept);

  expect(sampled(evicted)).toBe(true);
  expect(sampled(kept)).toBe(false);
});
