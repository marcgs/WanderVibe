import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import pino, { type DestinationStream, type Logger, type LogFn } from "pino";
import { requestIdFrom } from "@/lib/request-id";
import { scrubValue } from "@/lib/redact";
import { activeSpanIsPlatformProbe } from "@/lib/span-export";

let emitting = false;

function severityNumber(level: number): SeverityNumber {
  if (level >= 60) return SeverityNumber.FATAL;
  if (level >= 50) return SeverityNumber.ERROR;
  if (level >= 40) return SeverityNumber.WARN;
  if (level >= 30) return SeverityNumber.INFO;
  if (level >= 20) return SeverityNumber.DEBUG;
  return SeverityNumber.TRACE;
}

function severityText(level: number): string {
  if (level >= 60) return "fatal";
  if (level >= 50) return "error";
  if (level >= 40) return "warn";
  if (level >= 30) return "info";
  if (level >= 20) return "debug";
  return "trace";
}

function ensureRequestId(args: unknown[]): void {
  const first = args[0];
  if (first && typeof first === "object" && !Array.isArray(first)) {
    const record = first as Record<string, unknown>;
    if (typeof record.requestId === "string" && record.requestId.length > 0) {
      return;
    }
    record.requestId = requestIdFrom();
    return;
  }
  args.unshift({ requestId: requestIdFrom() });
}

function emitLog(level: number, args: unknown[]): void {
  if (emitting) return;
  emitting = true;
  try {
    const attributes: Record<string, string> = {};
    let body = "";
    for (const arg of args) {
      if (typeof arg === "string") {
        body = arg;
        continue;
      }
      if (!arg || typeof arg !== "object" || Array.isArray(arg)) continue;
      for (const [key, value] of Object.entries(
        arg as Record<string, unknown>,
      )) {
        if (
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean"
        ) {
          attributes[key] = String(value);
        }
      }
    }
    // Info logs on a platform probe are not exported. A failed probe logs at warn.
    // A manual or smoke-test call is not a platform probe, so its logs stay.
    if (level < 40 && activeSpanIsPlatformProbe()) return;
    // No-op until the Azure Monitor distro registers a logger provider.
    logs.getLogger("wandervibe").emit({
      severityNumber: severityNumber(level),
      severityText: severityText(level),
      body,
      attributes,
    });
  } finally {
    emitting = false;
  }
}

export function createLogger(destination?: DestinationStream): Logger {
  const options = {
    level: process.env.LOG_LEVEL ?? "info",
    formatters: {
      level(label: string) {
        return { level: label };
      },
    },
    hooks: {
      logMethod(
        this: Logger,
        args: Parameters<LogFn>,
        method: LogFn,
        level: number,
      ) {
        const scrubbed = args.map((arg) => scrubValue(arg));
        ensureRequestId(scrubbed);
        try {
          emitLog(level, scrubbed);
        } catch {
          // Export failures stay off the request path. Stdout still gets the line.
        }
        method.apply(this, scrubbed as Parameters<LogFn>);
      },
    },
  };
  return destination ? pino(options, destination) : pino(options);
}

export const logger = createLogger();

// The database error stays in the catch. Readiness logs the fact of failure only.
export function logReadyFailure(requestId: string): void {
  logger.warn({ requestId }, "Readiness check failed");
}
