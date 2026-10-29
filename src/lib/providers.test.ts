import { expect, test } from "vitest";
import { configuredProviders } from "./providers";

test("oauth providers do not link accounts that share an email", () => {
  const providers = configuredProviders({
    AUTH_GOOGLE_ID: "google-id",
    AUTH_GOOGLE_SECRET: "google-secret",
    AUTH_MICROSOFT_ENTRA_ID_ID: "entra-id",
    AUTH_MICROSOFT_ENTRA_ID_SECRET: "entra-secret",
    AUTH_MICROSOFT_ENTRA_ID_ISSUER:
      "https://login.microsoftonline.com/tenant/v2.0",
  } as unknown as NodeJS.ProcessEnv);

  expect(providers).toHaveLength(2);
  for (const provider of providers) {
    const options = provider as {
      allowDangerousEmailAccountLinking?: boolean;
      options?: { allowDangerousEmailAccountLinking?: boolean };
    };
    expect(options.allowDangerousEmailAccountLinking).not.toBe(true);
    expect(options.options?.allowDangerousEmailAccountLinking).not.toBe(true);
  }
});

test("a single provider can be configured on its own", () => {
  const providers = configuredProviders({
    AUTH_GOOGLE_ID: "google-id",
    AUTH_GOOGLE_SECRET: "google-secret",
  } as unknown as NodeJS.ProcessEnv);

  expect(
    providers.map((provider) => {
      const record = provider as unknown as { id?: string; name?: string };
      return record.id ?? record.name;
    }),
  ).toEqual(["google"]);
});
