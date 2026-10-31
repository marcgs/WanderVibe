import { Suspense } from "react";
import { connection } from "next/server";
import { notFound, redirect } from "next/navigation";
import { AccountBar } from "@/app/account-bar";
import { listTripDays } from "@/lib/trip-days";
import { requireUser } from "@/lib/session";
import { readTripForUser } from "@/lib/trip";
import { toTripSummary } from "@/lib/trip-input";
import { TripScreen } from "./trip-screen";

// The ownership check finishes before any Suspense boundary. A boundary would
// start a 200 stream, so a missing trip could not answer 404. See the
// streaming status-code rules. Another user's trip uses the same not-found.
export const instant = false;

export default async function TripPage({ params }: PageProps<"/trips/[id]">) {
  await connection();
  const user = await requireUser();
  const { id } = await params;
  const result = await readTripForUser(user.id, id);
  if (result.status === "unauthorized") redirect("/signin");
  if (result.status === "not_found") notFound();

  return (
    <TripScreen
      trip={toTripSummary(result.trip)}
      days={listTripDays(result.trip.startDate, result.trip.endDate)}
      account={
        <Suspense fallback={null}>
          <AccountBar />
        </Suspense>
      }
    />
  );
}
