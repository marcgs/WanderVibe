export type TripAuthorization =
  { allowed: true } | { allowed: false; status: 401 | 403 };

// A trip belongs to one user today. Sharing adds TripMember later. See ADR-0004.
export function authorizeTrip(
  viewer: { id: string } | null,
  trip: { ownerId: string },
): TripAuthorization {
  if (!viewer?.id) {
    return { allowed: false, status: 401 };
  }
  if (viewer.id !== trip.ownerId) {
    return { allowed: false, status: 403 };
  }
  return { allowed: true };
}
