import { defineConfig, devices } from "@playwright/test";

// A second server with no AUTH_SECRET and no provider credentials.
// The main config always sets AUTH_SECRET so the test traveler can sign in.
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  ),
);
for (const name of [
  "AUTH_SECRET",
  "AUTH_GOOGLE_ID",
  "AUTH_GOOGLE_SECRET",
  "AUTH_MICROSOFT_ENTRA_ID_ID",
  "AUTH_MICROSOFT_ENTRA_ID_SECRET",
  "AUTH_MICROSOFT_ENTRA_ID_ISSUER",
]) {
  env[name] = "";
}
env.AUTH_TEST_LOGIN = "true";
env.AUTH_TRUST_HOST = "true";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/unconfigured.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:3001",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run dev -- --port 3001",
    url: "http://localhost:3001",
    reuseExistingServer: false,
    timeout: 120_000,
    env,
  },
  projects: [
    {
      name: "unconfigured",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
