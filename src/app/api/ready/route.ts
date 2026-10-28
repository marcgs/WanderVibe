import { connection } from "next/server";
import { prisma } from "@/lib/prisma";

const noStore = { "cache-control": "no-store" } as const;

// Below the platform readiness probe (5s) and the driver's connect timeout (3s).
const readyTimeoutMs = 2_500;

function readyResponse(status: "ok" | "unavailable", httpStatus: 200 | 503) {
  return Response.json({ status }, { status: httpStatus, headers: noStore });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

// Deploy smoke tests call this to prove the container can reach Postgres.
// The body is only ok or unavailable: no host, SQL, or credential text.
export async function GET() {
  await connection();

  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, readyTimeoutMs);
    return readyResponse("ok", 200);
  } catch {
    console.error("Readiness check failed");
    return readyResponse("unavailable", 503);
  }
}
