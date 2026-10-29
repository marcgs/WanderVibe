// Auth.js and the sign-in form only return to a path on this app.
export function safeCallbackUrl(
  value: string | string[] | undefined | null,
): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (
    !raw ||
    !raw.startsWith("/") ||
    raw.startsWith("//") ||
    raw.includes("\\") ||
    raw.includes("://")
  ) {
    return "/";
  }
  return raw;
}
