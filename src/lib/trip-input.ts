export const tripTitleMaxLength = 120;
export const tripDestinationMaxLength = 160;

export const tripFieldError = {
  titleRequired: "Enter a trip name.",
  titleTooLong: `Trip name must be ${tripTitleMaxLength} characters or fewer.`,
  destinationRequired: "Enter a destination.",
  destinationTooLong: `Destination must be ${tripDestinationMaxLength} characters or fewer.`,
  startRequired: "Enter a start date.",
  startInvalid: "Enter a valid start date.",
  endRequired: "Enter an end date.",
  endInvalid: "Enter a valid end date.",
  endBeforeStart: "End date must be on or after the start date.",
} as const;

export type TripField = "title" | "destination" | "startDate" | "endDate";

export type TripFieldErrors = Partial<Record<TripField | "form", string>>;

export type TripInput = {
  title: string;
  destination: string;
  startDate: Date;
  endDate: Date;
};

export type TripFormState = {
  ok: boolean;
  errors: TripFieldErrors;
};

export const emptyTripFormState: TripFormState = {
  ok: false,
  errors: {},
};

export type TripJson = {
  id: string;
  title: string;
  destination: string;
  startDate: string;
  endDate: string;
};

export type TripSummary = TripJson & { dateRange: string };

type TripDates = {
  id: string;
  title: string;
  destination: string;
  startDate: Date;
  endDate: Date;
};

const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/;

const dayFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseDateField(value: unknown): Date | "missing" | "invalid" {
  if (typeof value !== "string") {
    return value == null ? "missing" : "invalid";
  }
  const trimmed = value.trim();
  if (!trimmed) return "missing";
  const match = isoDate.exec(trimmed);
  if (!match) return "invalid";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return "invalid";
  }
  return date;
}

// Reads the trip name from `title`. A client-supplied owner id is ignored.
export function parseTripInput(
  input: unknown,
): { ok: true; value: TripInput } | { ok: false; errors: TripFieldErrors } {
  const record = isRecord(input) ? input : {};
  const errors: TripFieldErrors = {};

  const title = typeof record.title === "string" ? record.title.trim() : "";
  if (!title) errors.title = tripFieldError.titleRequired;
  else if ([...title].length > tripTitleMaxLength) {
    errors.title = tripFieldError.titleTooLong;
  }

  const destination =
    typeof record.destination === "string" ? record.destination.trim() : "";
  if (!destination) errors.destination = tripFieldError.destinationRequired;
  else if ([...destination].length > tripDestinationMaxLength) {
    errors.destination = tripFieldError.destinationTooLong;
  }

  const startDate = parseDateField(record.startDate);
  if (startDate === "missing") errors.startDate = tripFieldError.startRequired;
  else if (startDate === "invalid") {
    errors.startDate = tripFieldError.startInvalid;
  }

  const endDate = parseDateField(record.endDate);
  if (endDate === "missing") errors.endDate = tripFieldError.endRequired;
  else if (endDate === "invalid") errors.endDate = tripFieldError.endInvalid;
  else if (
    startDate instanceof Date &&
    endDate.getTime() < startDate.getTime()
  ) {
    errors.endDate = tripFieldError.endBeforeStart;
  }

  if (
    errors.title ||
    errors.destination ||
    errors.startDate ||
    errors.endDate
  ) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      title,
      destination,
      startDate: startDate as Date,
      endDate: endDate as Date,
    },
  };
}

export function compareTripsByStartDate(
  a: { id: string; startDate: Date },
  b: { id: string; startDate: Date },
): number {
  const byStart = a.startDate.getTime() - b.startDate.getTime();
  if (byStart !== 0) return byStart;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

export function formatIsoDate(date: Date): string {
  const year = date.getUTCFullYear().toString().padStart(4, "0");
  const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = date.getUTCDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatTripDateRange(start: Date, end: Date): string {
  const startLabel = dayFormat.format(start);
  const endLabel = dayFormat.format(end);
  if (startLabel === endLabel) return startLabel;
  return `${startLabel} – ${endLabel}`;
}

export function toTripJson(trip: TripDates): TripJson {
  return {
    id: trip.id,
    title: trip.title,
    destination: trip.destination,
    startDate: formatIsoDate(trip.startDate),
    endDate: formatIsoDate(trip.endDate),
  };
}

export function toTripSummary(trip: TripDates): TripSummary {
  return {
    ...toTripJson(trip),
    dateRange: formatTripDateRange(trip.startDate, trip.endDate),
  };
}
