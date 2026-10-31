// Auth.js and the sign-in form only return to a path on this app.
// The decoded copy is only for the safety checks. The original is returned
// so encoded query parameters stay encoded.
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
  return raw;
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
