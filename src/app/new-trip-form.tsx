"use client";

import { useActionState, useEffect } from "react";
import {
  emptyTripFormState,
  type TripField,
  type TripFormState,
} from "@/lib/trip-input";

type TripAction = (
  previous: TripFormState,
  formData: FormData,
) => Promise<TripFormState>;

const fields: { id: TripField; label: string; type: "text" | "date" }[] = [
  { id: "title", label: "Trip name", type: "text" },
  { id: "destination", label: "Destination", type: "text" },
  { id: "startDate", label: "Start date", type: "date" },
  { id: "endDate", label: "End date", type: "date" },
];

export function NewTripForm({ action }: { action: TripAction }) {
  const [state, formAction, pending] = useActionState(
    action,
    emptyTripFormState,
  );

  useEffect(() => {
    const firstInvalid = fields.find((field) => state.errors[field.id]);
    if (!firstInvalid) return;
    document.getElementById(firstInvalid.id)?.focus();
  }, [state]);

  return (
    <form
      key={state.revision}
      action={formAction}
      noValidate
      className="flex min-w-0 flex-col gap-4"
    >
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        {fields.map((field) => (
          <Field
            key={field.id}
            field={field}
            value={state[field.id]}
            error={state.errors[field.id]}
            wide={field.id === "title" || field.id === "destination"}
          />
        ))}
      </div>
      {state.errors.form ? (
        <p role="alert" className="text-sm text-red-700">
          {state.errors.form}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="bg-accent w-full rounded-full px-4 py-3 text-sm font-semibold text-white disabled:opacity-60 sm:w-auto sm:self-start sm:px-6"
      >
        {pending ? "Saving…" : "Create trip"}
      </button>
    </form>
  );
}

function Field({
  field,
  value,
  error,
  wide,
}: {
  field: (typeof fields)[number];
  value: string;
  error: TripFormState["errors"][TripField];
  wide: boolean;
}) {
  const errorId = `${field.id}-error`;
  return (
    <div className={wide ? "min-w-0 sm:col-span-2" : "min-w-0"}>
      <label htmlFor={field.id} className="text-sm font-medium text-stone-800">
        {field.label}
      </label>
      <input
        id={field.id}
        name={field.id}
        type={field.type}
        defaultValue={value}
        autoComplete="off"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="focus-visible:border-accent focus-visible:ring-accent/30 mt-1 w-full min-w-0 rounded-xl border border-stone-300 bg-white px-3 py-2 text-base text-stone-900 outline-none focus-visible:ring-2"
      />
      {error ? (
        <p id={errorId} role="alert" className="mt-1 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
