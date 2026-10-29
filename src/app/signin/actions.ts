"use server";

import { redirect } from "next/navigation";
import { signIn, signOut } from "@/auth";
import { safeCallbackUrl } from "@/lib/callback-url";
import { createTestSession } from "@/lib/create-test-session";
import { isTestLoginEnabled } from "@/lib/test-login";

function callbackFrom(formData: FormData) {
  const value = formData.get("callbackUrl");
  return safeCallbackUrl(typeof value === "string" ? value : undefined);
}

export async function signInWithGoogle(formData: FormData) {
  await signIn("google", { redirectTo: callbackFrom(formData) });
}

export async function signInWithMicrosoft(formData: FormData) {
  await signIn("microsoft-entra-id", { redirectTo: callbackFrom(formData) });
}

export async function signInAsTestTraveler(formData: FormData) {
  if (!isTestLoginEnabled()) {
    redirect("/signin");
  }
  await createTestSession();
  redirect(callbackFrom(formData));
}

export async function signOutAction() {
  await signOut({ redirectTo: "/signin" });
}
