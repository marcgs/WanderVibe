import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { HomeScreen } from "./home-screen";

test("home page shows the WanderVibe placeholder", () => {
  render(<HomeScreen />);

  expect(
    screen.getByRole("heading", { level: 1, name: "WanderVibe" }),
  ).toBeInTheDocument();
  expect(screen.getByText(/Plan a trip in your own time/)).toBeInTheDocument();
});
