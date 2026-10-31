import { Suspense } from "react";
import { connection } from "next/server";
import { AccountBar } from "@/app/account-bar";
import { HomeScreen } from "@/app/home-screen";
import { NewTripForm } from "@/app/new-trip-form";
import { TripList, TripListFallback } from "@/app/trip-list";
import { createTripAction } from "@/app/trips/actions";
import { listTripsForUser } from "@/lib/trip";
import { toTripSummary } from "@/lib/trip-input";
import { requireUser } from "@/lib/session";

export default function HomePage() {
  return (
    <HomeScreen
      account={
        <Suspense fallback={null}>
          <AccountBar />
        </Suspense>
      }
      trips={
        <Suspense fallback={<TripListFallback />}>
          <UserTrips />
        </Suspense>
      }
      form={<NewTripForm action={createTripAction} />}
    />
  );
}

async function UserTrips() {
  await connection();
  const user = await requireUser();
  const trips = await listTripsForUser(user.id);
  return <TripList trips={trips.map(toTripSummary)} />;
}
