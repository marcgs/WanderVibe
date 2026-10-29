import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";

export const currentUser = cache(async () => {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) return null;
  return {
    id: user.id,
    name: user.name ?? null,
    email: user.email ?? null,
  };
});

export async function requireUser() {
  const user = await currentUser();
  if (!user) {
    redirect("/signin");
  }
  return user;
}
