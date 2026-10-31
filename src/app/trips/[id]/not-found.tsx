import Link from "next/link";

export default function TripNotFound() {
  return (
    <main className="mx-auto flex w-full max-w-3xl min-w-0 flex-1 flex-col px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="text-4xl font-semibold tracking-tight text-stone-900">
        Trip not found
      </h1>
      <p className="mt-3 max-w-md text-lg text-stone-600">
        That trip does not exist.
      </p>
      <Link
        href="/"
        className="bg-accent mt-6 inline-flex w-fit rounded-full px-4 py-3 text-sm font-semibold text-white"
      >
        Back to your trips
      </Link>
    </main>
  );
}
