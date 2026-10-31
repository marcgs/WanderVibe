import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { tripFieldError, type TripFormState } from "@/lib/trip-input";
import { NewTripForm } from "./new-trip-form";

test("invalid input shows the server's inline errors", async () => {
  const action = vi.fn(async (): Promise<TripFormState> => ({
    ok: false,
    errors: {
      title: tripFieldError.titleRequired,
      endDate: tripFieldError.endBeforeStart,
    },
  }));
  render(<NewTripForm action={action} />);

  const form = screen
    .getByRole("button", { name: "Create trip" })
    .closest("form");
  expect(form).not.toBeNull();
  form?.requestSubmit();

  expect(await screen.findByText(tripFieldError.titleRequired)).toBeVisible();
  expect(screen.getByText(tripFieldError.endBeforeStart)).toBeVisible();
  expect(screen.getByLabelText("Trip name")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  expect(screen.getByLabelText("End date")).toHaveAttribute(
    "aria-describedby",
    "endDate-error",
  );
});
