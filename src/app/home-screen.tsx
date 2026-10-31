import type { ReactNode } from "react";

export function HomeScreen({
  trips,
  form,
  account,
}: {
  trips: ReactNode;
  form: ReactNode;
  account?: ReactNode;
}) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-8 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-accent text-sm font-semibold tracking-[0.18em] uppercase">
            Personal trip planning
          </p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight text-stone-900 sm:text-5xl">
            WanderVibe
          </h1>
          <p className="mt-3 max-w-md text-lg leading-7 text-stone-600">
            Plan a trip in your own time.
          </p>
        </div>
        {account}
      </header>
      <section className="mt-10" aria-labelledby="your-trips-heading">
        <h2
          id="your-trips-heading"
          className="text-xl font-semibold text-stone-900"
        >
          Your trips
        </h2>
        {trips}
      </section>
      <section
        id="new-trip"
        aria-labelledby="new-trip-heading"
        className="mt-10 scroll-mt-8"
      >
        <h2
          id="new-trip-heading"
          className="text-xl font-semibold text-stone-900"
        >
          New trip
        </h2>
        <div className="mt-4 rounded-3xl border border-stone-200 bg-white px-4 py-6 shadow-sm sm:px-6">
          {form}
        </div>
      </section>
    </main>
  );
}
