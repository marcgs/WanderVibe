const staticExtension = /\.(?:svg|png|jpg|jpeg|gif|webp|ico)$/i;

// Mirrors src/proxy.ts config.matcher. /api is included even for file-like paths.
export function shouldRunProxy(pathname: string): boolean {
  if (pathname === "/api" || pathname.startsWith("/api/")) return true;
  if (
    pathname.startsWith("/_next/static") ||
    pathname.startsWith("/_next/image")
  ) {
    return false;
  }
  if (staticExtension.test(pathname)) return false;
  return true;
}
