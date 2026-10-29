export const testTraveler = {
  email: "playwright@wandervibe.test",
  name: "Test Traveler",
} as const;

// Production ignores the flag. The container image sets NODE_ENV=production,
// so a copied environment variable cannot turn this on in Azure.
// NODE_ENV is read from the process, not from the argument, so a caller
// cannot pretend this is development.
export function isTestLoginEnabled(env?: {
  AUTH_TEST_LOGIN?: string;
}): boolean {
  const source = env ?? process.env;
  if (process.env.NODE_ENV === "production") return false;
  return source.AUTH_TEST_LOGIN === "true";
}
