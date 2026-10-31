import { connection } from "next/server";
import { signOutAction } from "@/app/signin/actions";
import { requireUser } from "@/lib/session";

export async function AccountBar() {
  await connection();
  const user = await requireUser();
  const label = user.name ?? user.email ?? "traveler";

  return (
    <div className="flex flex-col gap-3 sm:items-end">
      <p className="text-sm text-stone-600">Signed in as {label}</p>
      <form action={signOutAction}>
        <button
          type="submit"
          className="rounded-full border border-stone-300 px-4 py-2 text-sm font-medium text-stone-800"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
