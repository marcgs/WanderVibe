import type { ReactNode } from "react";
import Link from "next/link";
import type { TripDay } from "@/lib/trip-days";
import type { TripSummary } from "@/lib/trip-input";

export function TripScreen({
  trip,
  days,
  account,
}: {
  trip: TripSummary;
  days: TripDay[];
  account?: ReactNode;
}) {
  return (
    <main className="mx-auto flex w-full max-w-3xl min-w-0 flex-1 flex-col px-4 py-8 sm:px-6 sm:py-12">
      <header className="flex min-w-0 flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Link href="/" className="text-accent text-sm font-semibold">
            Your trips
          </Link>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight break-words text-stone-900 sm:text-5xl">
            {trip.title}
          </h1>
          <p className="mt-3 text-lg break-words text-stone-700">
            {trip.destination}
          </p>
          <p className="mt-2 text-sm text-stone-500">{trip.dateRange}</p>
        </div>
        {account}
      </header>
      <div className="mt-10 flex min-w-0 flex-col gap-4">
        {days.map((day) => (
          <section
            key={day.isoDate}
            aria-labelledby={`day-${day.isoDate}`}
            className="min-w-0 rounded-3xl border border-stone-200 bg-white px-4 py-5 sm:px-6"
          >
            <h2
              id={`day-${day.isoDate}`}
              className="text-lg font-semibold text-stone-900"
            >
              {day.label}
            </h2>
            <p className="mt-2 text-sm text-stone-500">No plans yet.</p>
          </section>
        ))}
      </div>
    </main>
  );
}
