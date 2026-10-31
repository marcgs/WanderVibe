import { connection, type NextRequest } from "next/server";
import { handlers } from "@/auth";

export async function GET(request: NextRequest) {
  await connection();
  return handlers.GET(request);
}

export async function POST(request: NextRequest) {
  await connection();
  return handlers.POST(request);
}
