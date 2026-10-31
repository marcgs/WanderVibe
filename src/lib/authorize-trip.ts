import { prisma } from "@/lib/prisma";

export type TripAuthorization =
  { allowed: true } | { allowed: false; status: 401 | 404 };

// A trip belongs to one user today. Sharing adds TripMember later. See ADR-0004.
// Another user's trip is 404 so the response does not reveal that it exists.
export function authorizeTrip(
  viewer: { id: string } | null,
  trip: { ownerId: string },
): TripAuthorization {
  if (!viewer?.id) {
    return { allowed: false, status: 401 };
  }
  if (viewer.id !== trip.ownerId) {
    return { allowed: false, status: 404 };
  }
  return { allowed: true };
}

// Looks up by owner and id together, so a miss and someone else's trip
// are the same result: null.
export function findOwnedTrip(userId: string, tripId: string) {
  return prisma.trip.findFirst({
    where: { id: tripId, ownerId: userId },
  });
}
