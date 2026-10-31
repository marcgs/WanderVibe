export async function register(): Promise<void> {
  try {
    if (process.env.NEXT_RUNTIME !== "nodejs") return;
    // Unset locally and in the CI image. Importing the distro stays behind this check.
    if (!process.env.APPLICATIONINSIGHTS_CONNECTION_STRING?.trim()) return;
    const { startTelemetry } = await import("@/lib/telemetry");
    startTelemetry();
  } catch {
    // Next.js fails the server if register() throws. Telemetry must not do that.
    // console.error stays valid in the Edge bundle of this file. The message is fixed.
    console.error(
      JSON.stringify({ level: "error", msg: "Telemetry did not start" }),
    );
  }
}

export async function onRequestError(
  error: unknown,
  request: {
    path: string;
    method: string;
    headers: { [key: string]: string | string[] };
  },
  context: {
    routePath: string;
    routeType: string;
  },
): Promise<void> {
  try {
    const { reportRequestError } = await import("@/lib/request-error");
    reportRequestError(error, request, context);
  } catch {
    // Reporting a failure must not replace the original error.
  }
}
