import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { SignInError } from "./sign-in-error";

afterEach(() => {
  cleanup();
});

test("an unlinked account error is announced", () => {
  render(<SignInError error="OAuthAccountNotLinked" />);

  const status = screen.getByRole("status");
  expect(status).toHaveAttribute("aria-live", "polite");
  expect(status).toHaveTextContent(/another sign-in method/);
});

test("the live region stays present when there is no error", () => {
  const { getByRole } = render(<SignInError />);

  expect(getByRole("status")).toBeEmptyDOMElement();
});
