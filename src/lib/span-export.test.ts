import { expect, test } from "vitest";
import { TraceFlags } from "@opentelemetry/api";
import { createExportSpanProcessor, type ExportSpan } from "./span-export";

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

test("successful probes are dropped and failed probes are kept", () => {
  const processor = createExportSpanProcessor();
  const health = span({
    name: "GET /api/health",
    traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    httpStatus: 200,
  });
  const ready = span({
    name: "GET /api/ready",
    traceId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    httpStatus: 503,
  });
  const query = span({
    name: "pg.query:SELECT wandervibe",
    traceId: ready.flags.traceId,
    attributes: { "db.query.text": "SELECT 1" },
  });
  const bubble = span({
    name: "GET",
    traceId: "cccccccccccccccccccccccccccccccc",
    httpStatus: 200,
    bubble: true,
    attributes: { "http.target": "/trips" },
  });

  processor.onStart(health);
  processor.onEnd(health);
  processor.onStart(ready);
  processor.onStart(query);
  processor.onEnd(query);
  processor.onEnd(ready);
  processor.onEnd(bubble);

  expect(health.flags.traceFlags & TraceFlags.SAMPLED).toBe(0);
  expect(query.flags.traceFlags & TraceFlags.SAMPLED).toBe(0);
  expect(ready.flags.traceFlags & TraceFlags.SAMPLED).toBe(TraceFlags.SAMPLED);
  expect(bubble.flags.traceFlags & TraceFlags.SAMPLED).toBe(0);
  expect(query.attributes?.["db.query.text"]).toBe("SELECT 1");
});
