import { authorizeTrip, findOwnedTrip, isTripId } from "@/lib/authorize-trip";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import type { TripFieldErrors, TripInput } from "@/lib/trip-input";

function errorCode(error: unknown): string {
  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[A-Za-z][A-Za-z0-9_]*$/.test(error.code)
  ) {
    return error.code;
  }
  return "unknown";
}

export function logRejectedTrip(errors: TripFieldErrors): void {
  logger.info({ fields: Object.keys(errors).sort() }, "Trip create rejected");
}

export function listTripsForUser(ownerId: string) {
  return prisma.trip.findMany({
    where: { ownerId },
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
  });
}

export type OwnedTrip = NonNullable<Awaited<ReturnType<typeof findOwnedTrip>>>;

export type OwnedTripResult =
  | { status: "ok"; trip: OwnedTrip }
  | { status: "unauthorized" }
  | { status: "not_found" };

// Logs a real trip id only. A path that is not an id can carry user content,
// so that value stays out of the log along with the name and destination.
export async function readTripForUser(
  userId: string,
  tripId: string,
): Promise<OwnedTripResult> {
  if (!userId) return { status: "unauthorized" };
  if (!isTripId(tripId)) {
    logger.info({ reason: "invalid_id" }, "Trip not found");
    return { status: "not_found" };
  }

  const trip = await findOwnedTrip(userId, tripId);
  if (!trip) {
    logger.info({ tripId }, "Trip not found");
    return { status: "not_found" };
  }

  const decision = authorizeTrip({ id: userId }, trip);
  if (!decision.allowed) {
    if (decision.status === 401) return { status: "unauthorized" };
    logger.info({ tripId: trip.id }, "Trip not found");
    return { status: "not_found" };
  }

  return { status: "ok", trip };
}

// Logs the trip id only. The name and destination stay out of the log.
export async function createTripForUser(ownerId: string, input: TripInput) {
  try {
    const trip = await prisma.trip.create({
      data: {
        title: input.title,
        destination: input.destination,
        startDate: input.startDate,
        endDate: input.endDate,
        ownerId,
      },
    });
    logger.info({ tripId: trip.id }, "Trip created");
    return trip;
  } catch (error) {
    logger.error({ code: errorCode(error) }, "Trip create failed");
    throw error;
  }
}
