import { connection } from "next/server";
import { requireApiUser } from "@/lib/require-api-user";
import {
  createTripForUser,
  listTripsForUser,
  logRejectedTrip,
} from "@/lib/trip";
import { parseTripInput, toTripJson } from "@/lib/trip-input";

const noStore = { "cache-control": "no-store" } as const;

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: noStore });
}

export async function GET() {
  await connection();
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const trips = await listTripsForUser(user.id);
  return json({ trips: trips.map(toTripJson) }, 200);
}

export async function POST(request: Request) {
  await connection();
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const errors = { form: "The trip could not be read." };
    logRejectedTrip(errors);
    return json({ error: "invalid", fields: errors }, 400);
  }

  const parsed = parseTripInput(body);
  if (!parsed.ok) {
    logRejectedTrip(parsed.errors);
    return json({ error: "invalid", fields: parsed.errors }, 400);
  }

  try {
    const trip = await createTripForUser(user.id, parsed.value);
    return json({ trip: toTripJson(trip) }, 201);
  } catch {
    return json({ error: "unavailable" }, 500);
  }
}
