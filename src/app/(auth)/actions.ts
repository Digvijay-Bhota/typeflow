"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function login(formData: FormData) {
  const supabase = await createClient();
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const claimToken = formData.get("claimToken") as string | null;

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect("/login?error=Could not authenticate user");
  }

  revalidatePath("/", "layout");
  if (claimToken) {
    redirect(`/login?claimToken=${claimToken}&claimed=true`);
  }
  redirect("/dashboard");
}

export async function signup(formData: FormData) {
  const supabase = await createClient();
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const displayName = formData.get("displayName") as string;
  const claimToken = formData.get("claimToken") as string | null;

  // Supabase will automatically sign them in or send email depending on config.
  // Assuming auto-confirm for testing purposes or they need to click a link.
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: displayName,
      },
    },
  });

  if (error) {
    redirect("/signup?error=Could not create user");
  }

  revalidatePath("/", "layout");

  if (!data.session) {
    // Email confirmation required, no immediate session
    redirect("/signup/check-email");
  }

  if (claimToken) {
    redirect(`/login?claimToken=${claimToken}&claimed=true`);
  }
  redirect("/dashboard");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/");
}
