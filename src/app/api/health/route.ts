import { connection } from "next/server";

export async function GET() {
  await connection();

  return Response.json(
    { status: "ok" },
    {
      status: 200,
      headers: { "cache-control": "no-store" },
    },
  );
}
