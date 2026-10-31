import { formatIsoDate } from "@/lib/trip-input";

const msPerDay = 24 * 60 * 60 * 1000;

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const months = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export type TripDay = {
  isoDate: string;
  label: string;
};

function utcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

// "Mon, 12 Jan 2027". Weekday and calendar day are UTC, matching the stored dates.
export function formatTripDay(date: Date): string {
  const weekday = weekdays[date.getUTCDay()];
  const day = date.getUTCDate();
  const month = months[date.getUTCMonth()];
  const year = date.getUTCFullYear();
  return `${weekday}, ${day} ${month} ${year}`;
}

// One entry per calendar day from start through end, inclusive.
// Dates are the trip's UTC dates. No per-day rows are stored.
export function listTripDays(start: Date, end: Date): TripDay[] {
  const first = utcDay(start);
  const last = utcDay(end);
  if (!Number.isFinite(first) || !Number.isFinite(last) || last < first) {
    return [];
  }

  const days: TripDay[] = [];
  for (let time = first; time <= last; time += msPerDay) {
    const date = new Date(time);
    days.push({ isoDate: formatIsoDate(date), label: formatTripDay(date) });
  }
  return days;
}
