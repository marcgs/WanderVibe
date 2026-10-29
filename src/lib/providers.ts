import type { Provider } from "next-auth/providers";
import Google from "next-auth/providers/google";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";

// Both providers verify the email address. Email sign-in, which Auth.js uses
// to link accounts safely, is out of scope, so the same address from either
// provider stays one User. See ADR-0004.
const linkVerifiedEmail = { allowDangerousEmailAccountLinking: true } as const;

export function configuredProviders(
  env: NodeJS.ProcessEnv = process.env,
): Provider[] {
  const providers: Provider[] = [];

  if (env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET) {
    providers.push(
      Google({
        clientId: env.AUTH_GOOGLE_ID,
        clientSecret: env.AUTH_GOOGLE_SECRET,
        ...linkVerifiedEmail,
      }),
    );
  }

  if (env.AUTH_MICROSOFT_ENTRA_ID_ID && env.AUTH_MICROSOFT_ENTRA_ID_SECRET) {
    providers.push(
      MicrosoftEntraID({
        clientId: env.AUTH_MICROSOFT_ENTRA_ID_ID,
        clientSecret: env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
        issuer: env.AUTH_MICROSOFT_ENTRA_ID_ISSUER || undefined,
        ...linkVerifiedEmail,
      }),
    );
  }

  return providers;
}

export function configuredProviderFlags(env: NodeJS.ProcessEnv = process.env): {
  google: boolean;
  microsoft: boolean;
} {
  return {
    google: Boolean(env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET),
    microsoft: Boolean(
      env.AUTH_MICROSOFT_ENTRA_ID_ID && env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
    ),
  };
}
