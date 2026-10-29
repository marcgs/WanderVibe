// Auth.js and the sign-in form only return to a path on this app.
export function safeCallbackUrl(
  value: string | string[] | undefined | null,
): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return "/";

  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return "/";
  }

  if (
    hasControlOrWhitespace(raw) ||
    hasControlOrWhitespace(decoded) ||
    !decoded.startsWith("/") ||
    decoded.startsWith("//") ||
    decoded.includes("\\") ||
    decoded.includes("://") ||
    decoded.toLowerCase().includes("javascript:")
  ) {
    return "/";
  }

  return decoded;
}

function hasControlOrWhitespace(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 32 || code === 127) return true;
  }
  return false;
}
