import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { tripFieldError, type TripFormState } from "@/lib/trip-input";
import { NewTripForm } from "./new-trip-form";

function fill(element: HTMLElement, value: string) {
  fireEvent.change(element, { target: { value } });
}

test("invalid input keeps the submitted values and focuses the first invalid field", async () => {
  const action = vi.fn(
    async (
      previous: TripFormState,
      formData: FormData,
    ): Promise<TripFormState> => ({
      ok: false,
      revision: previous.revision + 1,
      title: String(formData.get("title")),
      destination: String(formData.get("destination")),
      startDate: String(formData.get("startDate")),
      endDate: String(formData.get("endDate")),
      errors: { endDate: tripFieldError.endBeforeStart },
    }),
  );
  render(<NewTripForm action={action} />);
  fill(screen.getByLabelText("Trip name"), "Lisbon");
  fill(screen.getByLabelText("Destination"), "Portugal");
  fill(screen.getByLabelText("Start date"), "2027-06-08");
  fill(screen.getByLabelText("End date"), "2027-06-01");

  screen.getByLabelText("Trip name").closest("form")?.requestSubmit();

  expect(await screen.findByText(tripFieldError.endBeforeStart)).toBeVisible();
  expect(screen.getByLabelText("Trip name")).toHaveValue("Lisbon");
  expect(screen.getByLabelText("Destination")).toHaveValue("Portugal");
  expect(screen.getByLabelText("Start date")).toHaveValue("2027-06-08");
  expect(screen.getByLabelText("End date")).toHaveValue("2027-06-01");
  expect(screen.getByLabelText("End date")).toHaveFocus();
  expect(screen.getByLabelText("End date")).toHaveAttribute(
    "aria-describedby",
    "endDate-error",
  );
});
