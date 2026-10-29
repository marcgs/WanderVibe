export const testTraveler = {
  email: "playwright@wandervibe.test",
  name: "Test Traveler",
} as const;

// Production ignores the flag. The container image sets NODE_ENV=production,
// so a copied environment variable cannot turn this on in Azure.
export function isTestLoginEnabled(
  env: { NODE_ENV?: string; AUTH_TEST_LOGIN?: string } = process.env,
): boolean {
  return env.NODE_ENV !== "production" && env.AUTH_TEST_LOGIN === "true";
}
