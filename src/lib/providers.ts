import type { Provider } from "next-auth/providers";
import Google from "next-auth/providers/google";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";

// Account linking by email is off. Entra does not verify work or school
// addresses, so linking would let a second provider take over a user.
// A repeat sign-in with the same email and a different provider returns
// OAuthAccountNotLinked. See ADR-0004.
export function configuredProviders(
  env: NodeJS.ProcessEnv = process.env,
): Provider[] {
  const providers: Provider[] = [];

  if (env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET) {
    providers.push(
      Google({
        clientId: env.AUTH_GOOGLE_ID,
        clientSecret: env.AUTH_GOOGLE_SECRET,
      }),
    );
  }

  if (env.AUTH_MICROSOFT_ENTRA_ID_ID && env.AUTH_MICROSOFT_ENTRA_ID_SECRET) {
    providers.push(
      MicrosoftEntraID({
        clientId: env.AUTH_MICROSOFT_ENTRA_ID_ID,
        clientSecret: env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
        issuer: env.AUTH_MICROSOFT_ENTRA_ID_ISSUER || undefined,
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
