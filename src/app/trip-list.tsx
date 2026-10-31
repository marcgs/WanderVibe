import Link from "next/link";
import type { TripSummary } from "@/lib/trip-input";

export function TripListFallback() {
  return (
    <p className="mt-4 text-sm text-stone-500" aria-live="polite">
      Loading trips…
    </p>
  );
}

export function TripList({ trips }: { trips: TripSummary[] }) {
  if (trips.length === 0) {
    return (
      <div className="mt-4 rounded-3xl border border-dashed border-stone-300 bg-white px-6 py-10 text-center">
        <h3 className="text-lg font-semibold text-stone-900">No trips yet</h3>
        <p className="mx-auto mt-2 max-w-sm text-stone-600">
          Create your first trip to start planning. A name, a destination, and
          the dates are enough to begin.
        </p>
        <a
          href="#title"
          className="bg-accent mt-6 inline-flex rounded-full px-4 py-3 text-sm font-semibold text-white"
        >
          Create your first trip
        </a>
      </div>
    );
  }

  return (
    <ul className="mt-4 divide-y divide-stone-200 overflow-hidden rounded-3xl border border-stone-200 bg-white">
      {trips.map((trip) => (
        <li key={trip.id} className="min-w-0">
          <Link
            href={`/trips/${trip.id}`}
            className="block min-w-0 px-4 py-4 break-words hover:bg-stone-50 sm:px-6"
          >
            <h3 className="text-lg font-semibold text-stone-900">
              {trip.title}
            </h3>
            <p className="mt-1 text-stone-700">{trip.destination}</p>
            <p className="mt-2 text-sm text-stone-500">{trip.dateRange}</p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
