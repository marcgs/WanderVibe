import { connection } from "next/server";
import { prisma } from "@/lib/prisma";

const noStore = { "cache-control": "no-store" } as const;

function readyResponse(status: "ok" | "unavailable", httpStatus: 200 | 503) {
  return Response.json({ status }, { status: httpStatus, headers: noStore });
}

// Deploy smoke tests call this to prove the container can reach Postgres.
// The body is only ok or unavailable: no host, SQL, or credential text.
export async function GET() {
  await connection();

  try {
    await prisma.$queryRaw`SELECT 1`;
    return readyResponse("ok", 200);
  } catch {
    console.error("Readiness check failed");
    return readyResponse("unavailable", 503);
  }
}
