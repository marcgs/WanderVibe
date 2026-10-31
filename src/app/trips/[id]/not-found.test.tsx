import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import TripNotFound from "./not-found";

afterEach(() => {
  cleanup();
});

test("an unknown trip shows not-found and a link back to the list", () => {
  render(<TripNotFound />);

  expect(
    screen.getByRole("heading", { name: "Trip not found" }),
  ).toBeInTheDocument();
  expect(screen.getByText("That trip does not exist.")).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Back to your trips" }),
  ).toHaveAttribute("href", "/");
});
