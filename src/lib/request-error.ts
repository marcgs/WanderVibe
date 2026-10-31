import { SpanStatusCode, trace } from "@opentelemetry/api";
import { logger } from "@/lib/logger";
import { requestIdFromRecord } from "@/lib/request-id";
import { scrubString } from "@/lib/redact";

type ErrorRequest = {
  path: string;
  method: string;
  headers: { [key: string]: string | string[] | undefined };
};

type ErrorContext = {
  routePath: string;
};

export function exceptionForTelemetry(error: unknown): Error {
  const message = error instanceof Error ? error.message : "Request failed";
  const reported = new Error(scrubString(message));
  reported.name = error instanceof Error ? error.name : "Error";
  if (error instanceof Error && typeof error.stack === "string") {
    reported.stack = scrubString(error.stack);
  }
  return reported;
}

export function requestErrorFields(
  request: ErrorRequest,
  context: ErrorContext,
) {
  return {
    requestId: requestIdFromRecord(request.headers),
    method: request.method,
    path: request.path,
    route: context.routePath,
  };
}

// Next.js calls this for a server error. Headers are not copied: they hold
// the session cookie and the authorization header.
export function reportRequestError(
  error: unknown,
  request: ErrorRequest,
  context: ErrorContext,
): void {
  const fields = requestErrorFields(request, context);
  logger.error(fields, "Request failed");
  const reported = exceptionForTelemetry(error);
  const span = trace.getTracer("wandervibe").startSpan("exception");
  span.recordException(reported);
  span.setStatus({ code: SpanStatusCode.ERROR, message: reported.message });
  span.setAttribute("http.request.method", fields.method);
  span.setAttribute("http.route", fields.route);
  span.end();
}
