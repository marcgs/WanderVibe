export default function HomePage() {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <section className="w-full max-w-lg rounded-3xl border border-stone-200 bg-white px-8 py-12 text-center shadow-sm">
        <div
          aria-hidden="true"
          className="bg-accent mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl text-white"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-7 w-7"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 16c3.5-6 8-6 11.5-2" />
            <circle
              cx="17.5"
              cy="8.5"
              r="2"
              fill="currentColor"
              stroke="none"
            />
            <path d="M8 19h8" />
          </svg>
        </div>
        <p className="text-accent text-sm font-semibold tracking-[0.18em] uppercase">
          Personal trip planning
        </p>
        <h1 className="mt-3 text-5xl font-semibold tracking-tight text-stone-900">
          WanderVibe
        </h1>
        <p className="mx-auto mt-4 max-w-sm text-lg leading-8 text-stone-600">
          Plan a trip in your own time. Days, places, and notes will show up
          here.
        </p>
      </section>
    </main>
  );
}
