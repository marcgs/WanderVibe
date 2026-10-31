"use server";

import { redirect } from "next/navigation";
import { requireApiUser } from "@/lib/require-api-user";
import { createTripForUser, logRejectedTrip } from "@/lib/trip";
import {
  parseTripInput,
  type TripFieldErrors,
  type TripFormState,
} from "@/lib/trip-input";

function submittedText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function rejectedTrip(
  previous: TripFormState,
  formData: FormData,
  errors: TripFieldErrors,
): TripFormState {
  return {
    ok: false,
    revision: previous.revision + 1,
    errors,
    title: submittedText(formData, "title"),
    destination: submittedText(formData, "destination"),
    startDate: submittedText(formData, "startDate"),
    endDate: submittedText(formData, "endDate"),
  };
}

export async function createTripAction(
  previous: TripFormState,
  formData: FormData,
): Promise<TripFormState> {
  const user = await requireApiUser();
  if (user instanceof Response) {
    return rejectedTrip(previous, formData, {
      form: "Sign in to create a trip.",
    });
  }

  const parsed = parseTripInput({
    title: formData.get("title"),
    destination: formData.get("destination"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
  });
  if (!parsed.ok) {
    logRejectedTrip(parsed.errors);
    return rejectedTrip(previous, formData, parsed.errors);
  }

  try {
    await createTripForUser(user.id, parsed.value);
  } catch {
    return rejectedTrip(previous, formData, {
      form: "The trip could not be saved. Try again.",
    });
  }

  redirect("/");
}
