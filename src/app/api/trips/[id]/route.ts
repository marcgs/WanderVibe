import { connection } from "next/server";
import { authorizeTrip, findOwnedTrip } from "@/lib/authorize-trip";
import { logger } from "@/lib/logger";
import { requireApiUser } from "@/lib/require-api-user";
import { toTripJson } from "@/lib/trip-input";

const noStore = { "cache-control": "no-store" } as const;

function json(body: unknown, status: number, extra?: HeadersInit) {
  return Response.json(body, { status, headers: { ...noStore, ...extra } });
}

// Missing and someone else's trip are the same response. The log records the
// id only, never the name or destination. See ADR-0004.
function tripNotFound(tripId: string) {
  logger.info({ tripId }, "Trip not found");
  return json({ error: "not_found" }, 404);
}

async function ownedTrip(user: { id: string }, tripId: string) {
  const trip = await findOwnedTrip(user.id, tripId);
  if (!trip) return null;
  const decision = authorizeTrip(user, trip);
  if (!decision.allowed) return null;
  return trip;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  await connection();
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await context.params;
  const trip = await ownedTrip(user, id);
  if (!trip) return tripNotFound(id);
  return json({ trip: toTripJson(trip) }, 200);
}

// Editing a trip is story #8. Until then a change is refused after the
// ownership check, and someone else's trip is not found.
export async function PATCH(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  await connection();
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { id } = await context.params;
  const trip = await ownedTrip(user, id);
  if (!trip) return tripNotFound(id);
  logger.info({ tripId: trip.id }, "Trip change is not available");
  return json({ error: "not_supported" }, 405, { allow: "GET" });
}
