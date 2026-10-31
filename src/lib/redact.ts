// One scrubber for stdout and for spans exported to Application Insights.
// Emails, tokens, passwords, cookies, and connection strings stay out of both.
// Match on a decoded copy so percent-encoded keys, emails, and nested callback
// URLs are judged the same way as the plain forms.

const SENSITIVE_NAMES = [
  "password",
  "passwd",
  "pwd",
  "token",
  "access_token",
  "refresh_token",
  "id_token",
  "session_token",
  "code",
  "state",
  "secret",
  "authorization",
  "cookie",
  "email",
  "email_address",
  "connection_string",
  "database_url",
  "auth_secret",
  "instrumentation_key",
  "api_key",
  "client_secret",
] as const;

// Short names that also appear inside ordinary field names (status_code).
// Those match only as the whole key. Longer names also match as a suffix,
// so access_token, sessionToken, and user.email are covered by one list.
const EXACT_NAMES = new Set(["code", "state", "pwd"]);

const URL_SCHEMES = new Set(["http", "https", "postgresql", "postgres"]);

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const AUTH_SCHEME = /\b(Bearer|Basic|Digest|Negotiate)\s+\S+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const USERINFO_URL = /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^@\s/]+@[^\s'"]+/gi;

type Assignment = {
  separator: number;
  key: string;
  normalized: string;
};

type ReadValue = {
  contentStart: number;
  end: number;
};

export function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);
  if (!normalized) return false;
  return SENSITIVE_NAMES.some((name) => {
    if (normalized === name) return true;
    if (EXACT_NAMES.has(name)) return false;
    return normalized.endsWith(`_${name}`);
  });
}

export function scrubString(input: string): string {
  return redactDecoded(decodeRepeated(input), 0);
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
  if (value instanceof Date) return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: scrubString(value.message),
      stack: value.stack ? scrubString(value.stack) : undefined,
      cause:
        value.cause === undefined
          ? undefined
          : scrubValue(value.cause, seen, depth + 1),
    };
  }
  if (value instanceof Map) {
    const mapped: Record<string, unknown> = {};
    for (const [key, nested] of value) {
      const name = String(key);
      mapped[name] = isSensitiveKey(name)
        ? "[Redacted]"
        : scrubValue(nested, seen, depth + 1);
    }
    return mapped;
  }
  if (value instanceof Set) {
    return [...value].map((item) => scrubValue(item, seen, depth + 1));
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

function redactDecoded(text: string, depth: number): string {
  if (depth > 6) return "[Redacted]";
  let current = resetAndReplace(text, USERINFO_URL, "[Redacted]");
  current = resetAndReplace(current, JWT, "[Redacted]");
  current = redactAssignments(current, depth);
  current = resetAndReplace(current, AUTH_SCHEME, "$1 [Redacted]");
  current = resetAndReplace(current, EMAIL, "[Redacted]");
  return current;
}

function redactAssignments(text: string, depth: number): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const found = nextAssignment(text, i);
    if (!found) {
      out += text.slice(i);
      break;
    }
    if (URL_SCHEMES.has(found.normalized)) {
      out += text.slice(i, found.separator + 1);
      i = found.separator + 1;
      continue;
    }
    const value = readValue(text, found.separator + 1);
    if (value.end <= found.separator) {
      out += text[i];
      i += 1;
      continue;
    }
    out += text.slice(i, value.contentStart);
    out += isSensitiveKey(found.key)
      ? "[Redacted]"
      : redactDecoded(text.slice(value.contentStart, value.end), depth + 1);
    i = value.end;
  }
  return out;
}

function nextAssignment(text: string, from: number): Assignment | undefined {
  for (let separator = from; separator < text.length; separator += 1) {
    const mark = text[separator];
    if (mark !== ":" && mark !== "=") continue;
    let cursor = separator - 1;
    while (cursor >= from && /[ \t]/.test(text[cursor])) cursor -= 1;
    if (cursor >= from && (text[cursor] === '"' || text[cursor] === "'")) {
      cursor -= 1;
    }
    const keyEnd = cursor + 1;
    while (cursor >= from && /[\w.%-]/.test(text[cursor])) cursor -= 1;
    const keyStart = cursor + 1;
    if (keyStart >= keyEnd) continue;
    const key = text.slice(keyStart, keyEnd);
    if (!/[A-Za-z%]/.test(key)) continue;
    return { separator, key, normalized: normalizeKey(key) };
  }
  return undefined;
}

function readValue(text: string, valueStart: number): ReadValue {
  let cursor = valueStart;
  while (cursor < text.length && /[ \t]/.test(text[cursor])) cursor += 1;
  const contentStart = cursor;
  if (cursor >= text.length) return { contentStart, end: cursor };

  const quote = text[cursor];
  if (quote === '"' || quote === "'") {
    cursor += 1;
    while (cursor < text.length) {
      if (text[cursor] === "\\") {
        cursor += 2;
        continue;
      }
      if (text[cursor] === quote) {
        cursor += 1;
        break;
      }
      cursor += 1;
    }
    return { contentStart, end: cursor };
  }

  while (cursor < text.length) {
    const char = text[cursor];
    if (char === "&" || char === "," || char === "\n" || char === "\r") {
      break;
    }
    if (/\s/.test(char)) {
      let next = cursor;
      while (next < text.length && /\s/.test(text[next])) next += 1;
      // `password: hunter 2` is one value. Stop before the next assignment.
      if (/^[A-Za-z%][\w.%-]*\s*[:=]/.test(text.slice(next))) break;
      cursor = next;
      continue;
    }
    cursor += 1;
  }
  return { contentStart, end: cursor };
}

function normalizeKey(key: string): string {
  const decoded = decodeRepeated(key);
  const broken = decoded.replace(/([a-z0-9])([A-Z])/g, "$1_$2");
  return broken
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()
    .replace(/api_?key/g, "api_key");
}

function decodeRepeated(value: string): string {
  let current = value;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const next = decodePercent(current);
    if (next === current) break;
    current = next;
  }
  return current;
}

function decodePercent(value: string): string {
  if (!value.includes("%")) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value.replace(/(?:%[0-9A-Fa-f]{2})+/g, (sequence) => {
      try {
        return decodeURIComponent(sequence);
      } catch {
        return sequence;
      }
    });
  }
}

function resetAndReplace(
  value: string,
  pattern: RegExp,
  replacement: string,
): string {
  pattern.lastIndex = 0;
  return value.replace(pattern, replacement);
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
