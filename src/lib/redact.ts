// One scrubber for stdout and for spans exported to Application Insights.
// Emails, tokens, passwords, cookies, and connection strings stay out of both.

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const BEARER = /\bBearer\s+\S+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const INSTRUMENTATION_KEY = /InstrumentationKey=[^\s'"]+/gi;
const USERINFO_URL = /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^@\s/]+@[^\s'"]+/gi;
const SECRET_ASSIGNMENT =
  /\b(password|passwd|pwd|token|secret|authorization|cookie|connectionString|connection_string|database_url|auth_secret)\b\s*["']?\s*[:=]\s*["']?[^"',\s&]*/gi;
const QUERY_SECRET =
  /([?&#](?:access_token|id_token|refresh_token|token|code|state|password|passwd|secret|email|session|session_token)=)[^&#\s]*/gi;
const SESSION_COOKIE = /((?:session[-_]?token|authjs\.[^=\s;]+)=)[^;\s]+/gi;

const SENSITIVE_KEY =
  /password|passwd|\bpwd\b|token|secret|authorization|cookie|email|connection.?string|database_url|auth_secret|instrumentationkey|api[-_]?key/i;

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

export function scrubString(input: string): string {
  // Global patterns keep lastIndex. Reset so a later call cannot skip a match.
  for (const pattern of [
    EMAIL,
    BEARER,
    JWT,
    INSTRUMENTATION_KEY,
    USERINFO_URL,
    SECRET_ASSIGNMENT,
    QUERY_SECRET,
    SESSION_COOKIE,
  ]) {
    pattern.lastIndex = 0;
  }
  return input
    .replace(USERINFO_URL, "[Redacted]")
    .replace(INSTRUMENTATION_KEY, "InstrumentationKey=[Redacted]")
    .replace(JWT, "[Redacted]")
    .replace(BEARER, "Bearer [Redacted]")
    .replace(EMAIL, "[Redacted]")
    .replace(SECRET_ASSIGNMENT, "$1=[Redacted]")
    .replace(QUERY_SECRET, "$1[Redacted]")
    .replace(SESSION_COOKIE, "$1[Redacted]");
}

export function scrubValue(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
  depth = 0,
): unknown {
  if (depth > 6) return "[Redacted]";
  if (typeof value === "string") return scrubString(value);
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value == null
  ) {
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: scrubString(value.message),
      stack: value.stack ? scrubString(value.stack) : undefined,
    };
  }
  if (typeof value !== "object") return "[Redacted]";
  if (seen.has(value)) return "[Redacted]";
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => scrubValue(item, seen, depth + 1));
  }
  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    output[key] = isSensitiveKey(key)
      ? "[Redacted]"
      : scrubValue(nested, seen, depth + 1);
  }
  return output;
}

type ExportedSpan = {
  name?: string;
  attributes?: Record<string, unknown>;
  events?: { attributes?: Record<string, unknown> }[];
  status?: { message?: string };
};

// The Azure exporter reads attributes after earlier span processors return.
// Mutating the span here is what that exporter sends.
export function redactExportedSpan(span: ExportedSpan): void {
  if (typeof span.name === "string") span.name = scrubString(span.name);
  if (span.attributes) redactRecord(span.attributes);
  for (const event of span.events ?? []) {
    if (event.attributes) redactRecord(event.attributes);
  }
  if (span.status && typeof span.status.message === "string") {
    span.status.message = scrubString(span.status.message);
  }
}

function redactRecord(record: Record<string, unknown>): void {
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (isSensitiveKey(key)) {
      record[key] = "[Redacted]";
      continue;
    }
    if (typeof value === "string") {
      record[key] = scrubString(value);
      continue;
    }
    if (Array.isArray(value)) {
      record[key] = value.map((item) =>
        typeof item === "string" ? scrubString(item) : item,
      );
    }
  }
}
