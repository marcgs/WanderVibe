// Auth.js and the sign-in form only return to a path on this app.
// Decoding is only for the safety checks. The returned path keeps the
// encoding the URL parser accepted, so query parameters stay encoded.
export function safeCallbackUrl(
  value: string | string[] | undefined | null,
): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return "/";

  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return "/";
  }

  if (!isSameAppPath(raw) || !isSameAppPath(decoded)) return "/";

  // Collapse dot segments such as /.//evil.com and /%2e%2e/%2fevil.com.
  // Search and hash keep the encoding the URL parser already accepted.
  const url = new URL(raw, "http://localhost");
  if (url.origin !== "http://localhost") return "/";
  const normalized = `${url.pathname}${url.search}${url.hash}`;

  let normalizedDecoded: string;
  try {
    normalizedDecoded = decodeURIComponent(normalized);
  } catch {
    return "/";
  }
  if (!isSameAppPath(normalized) || !isSameAppPath(normalizedDecoded))
    return "/";
  return normalized;
}

function isSameAppPath(value: string): boolean {
  if (hasControlOrWhitespace(value)) return false;
  if (!value.startsWith("/") || value.startsWith("//")) return false;
  if (value.includes("\\") || value.includes("://")) return false;
  if (value.toLowerCase().includes("javascript:")) return false;
  return true;
}

function hasControlOrWhitespace(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 32 || code === 127) return true;
  }
  return false;
}
