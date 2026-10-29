export function signInErrorMessage(
  error: string | string[] | undefined,
): string | null {
  const code = Array.isArray(error) ? error[0] : error;
  if (!code) return null;
  if (code === "OAuthAccountNotLinked") {
    return "That email is already used by another sign-in method. Sign in with the one you used first.";
  }
  if (!/^[A-Za-z0-9]+$/.test(code)) return "Sign-in did not complete.";
  return `Sign-in did not complete (${code}).`;
}

export function SignInError({ error }: { error?: string | string[] }) {
  return (
    <p
      role="status"
      aria-live="polite"
      className="text-sm leading-6 text-stone-700"
    >
      {signInErrorMessage(error) ?? ""}
    </p>
  );
}
