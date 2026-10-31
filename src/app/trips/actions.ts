"use server";

import { redirect } from "next/navigation";
import { requireApiUser } from "@/lib/require-api-user";
import { createTripForUser, logRejectedTrip } from "@/lib/trip";
import {
  emptyTripFormState,
  parseTripInput,
  type TripFormState,
} from "@/lib/trip-input";

export async function createTripAction(
  _previous: TripFormState,
  formData: FormData,
): Promise<TripFormState> {
  const user = await requireApiUser();
  if (user instanceof Response) {
    return {
      ...emptyTripFormState,
      errors: { form: "Sign in to create a trip." },
    };
  }

  const parsed = parseTripInput({
    title: formData.get("title"),
    destination: formData.get("destination"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
  });
  if (!parsed.ok) {
    logRejectedTrip(parsed.errors);
    return { ok: false, errors: parsed.errors };
  }

  try {
    await createTripForUser(user.id, parsed.value);
  } catch {
    return {
      ok: false,
      errors: { form: "The trip could not be saved. Try again." },
    };
  }

  redirect("/");
}
