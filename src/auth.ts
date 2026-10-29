import { PrismaAdapter } from "@auth/prisma-adapter";
import NextAuth from "next-auth";
import { prisma } from "@/lib/prisma";
import { configuredProviders } from "@/lib/providers";

function expiresAt(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : new Date(0).toISOString();
}

// The adapter's published types target Prisma 6. This app uses Prisma 7.
// The adapter only calls the generated client. See ADR-0004.
const adapter = PrismaAdapter(
  prisma as unknown as Parameters<typeof PrismaAdapter>[0],
);

// Read at process start. Container Apps injects Key Vault values before the
// process starts, and Next.js does not inline these server variables at build.
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter,
  session: { strategy: "database" },
  // Container Apps terminates TLS. The app trusts that host. See ADR-0004.
  trustHost: true,
  pages: { signIn: "/signin" },
  providers: configuredProviders(),
  callbacks: {
    session({ session, user }) {
      return {
        expires: expiresAt(session.expires),
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
        },
      };
    },
  },
});
