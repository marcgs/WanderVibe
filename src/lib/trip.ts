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
