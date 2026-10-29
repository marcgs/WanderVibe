import { Suspense, type ReactNode } from "react";
import { connection } from "next/server";
import {
  signInAsTestTraveler,
  signInWithGoogle,
  signInWithMicrosoft,
} from "@/app/signin/actions";
import { safeCallbackUrl } from "@/lib/callback-url";
import { configuredProviderFlags } from "@/lib/providers";
import { isTestLoginEnabled } from "@/lib/test-login";

function SignInCard({ children }: { children?: ReactNode }) {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <section className="w-full max-w-lg rounded-3xl border border-stone-200 bg-white px-8 py-12 text-center shadow-sm">
        <p className="text-accent text-sm font-semibold tracking-[0.18em] uppercase">
          Personal trip planning
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-stone-900">
          Sign in
        </h1>
        <p className="mx-auto mt-4 max-w-sm text-lg leading-8 text-stone-600">
          Use Microsoft or Google. Your trips stay on this account.
        </p>
        {children}
      </section>
    </main>
  );
}

async function SignInForm({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string | string[] }>;
}) {
  await connection();
  const params = await searchParams;
  const callbackUrl = safeCallbackUrl(params.callbackUrl);
  const providers = configuredProviderFlags();
  const testLogin = isTestLoginEnabled();
  const buttonClass =
    "bg-accent w-full rounded-full px-4 py-3 text-sm font-semibold text-white";

  return (
    <SignInCard>
      <div className="mt-8 flex flex-col gap-3">
        {providers.microsoft ? (
          <form action={signInWithMicrosoft}>
            <input type="hidden" name="callbackUrl" value={callbackUrl} />
            <button type="submit" className={buttonClass}>
              Continue with Microsoft
            </button>
          </form>
        ) : null}
        {providers.google ? (
          <form action={signInWithGoogle}>
            <input type="hidden" name="callbackUrl" value={callbackUrl} />
            <button type="submit" className={buttonClass}>
              Continue with Google
            </button>
          </form>
        ) : null}
        {providers.microsoft || providers.google ? null : (
          <p className="text-sm leading-6 text-stone-600">
            Microsoft and Google are not configured in this environment.
          </p>
        )}
        {testLogin ? (
          <form action={signInAsTestTraveler}>
            <input type="hidden" name="callbackUrl" value={callbackUrl} />
            <button
              type="submit"
              className="w-full rounded-full border border-stone-300 px-4 py-3 text-sm font-semibold text-stone-800"
            >
              Sign in as test traveler
            </button>
          </form>
        ) : null}
      </div>
    </SignInCard>
  );
}

export default function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string | string[] }>;
}) {
  return (
    <Suspense fallback={<SignInCard />}>
      <SignInForm searchParams={searchParams} />
    </Suspense>
  );
}
