"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createHash } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { rateLimit } from "@/server/middleware/rateLimit";

const AUTH_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_IP_LIMIT = 20;
export const LOGIN_EMAIL_LIMIT = 5;
export const SIGNUP_IP_LIMIT = 10;
export const SIGNUP_EMAIL_LIMIT = 3;

// Same trusted-header convention used by every API route in this app
// (e.g. src/app/api/session/create/route.ts) — server actions have no
// Request object, so the header is read via next/headers instead.
async function getClientIp(): Promise<string> {
  const headerList = await headers();
  return headerList.get("x-forwarded-for") || "127.0.0.1";
}

// Hash the normalized email so the raw address isn't retained as a limiter key.
function hashEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  return createHash("sha256").update(normalized).digest("hex");
}

export async function login(formData: FormData) {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const claimToken = formData.get("claimToken") as string | null;

  const ip = await getClientIp();
  const emailHash = hashEmail(email);

  const [ipLimit, emailLimit] = await Promise.all([
    rateLimit(`login_ip_${ip}`, LOGIN_IP_LIMIT, AUTH_RATE_LIMIT_WINDOW_MS),
    rateLimit(`login_email_${emailHash}`, LOGIN_EMAIL_LIMIT, AUTH_RATE_LIMIT_WINDOW_MS),
  ]);

  if (!ipLimit.success || !emailLimit.success) {
    // Same generic outcome as a real auth failure — never reveal which
    // limiter (or whether the account) triggered it.
    redirect("/login?error=Could not authenticate user");
    return;
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect("/login?error=Could not authenticate user");
    return;
  }

  revalidatePath("/", "layout");
  if (claimToken) {
    redirect(`/login?claimToken=${claimToken}&claimed=true`);
    return;
  }
  redirect("/dashboard");
}

export async function signup(formData: FormData) {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const displayName = formData.get("displayName") as string;
  const claimToken = formData.get("claimToken") as string | null;

  const ip = await getClientIp();
  const emailHash = hashEmail(email);

  const [ipLimit, emailLimit] = await Promise.all([
    rateLimit(`signup_ip_${ip}`, SIGNUP_IP_LIMIT, AUTH_RATE_LIMIT_WINDOW_MS),
    rateLimit(`signup_email_${emailHash}`, SIGNUP_EMAIL_LIMIT, AUTH_RATE_LIMIT_WINDOW_MS),
  ]);

  if (!ipLimit.success || !emailLimit.success) {
    // Same generic outcome as a real signup failure — never reveal which
    // limiter triggered it.
    redirect("/signup?error=Could not create user");
    return;
  }

  const supabase = await createClient();

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
    return;
  }

  revalidatePath("/", "layout");

  if (!data.session) {
    // Email confirmation required, no immediate session
    redirect("/signup/check-email");
    return;
  }

  if (claimToken) {
    redirect(`/login?claimToken=${claimToken}&claimed=true`);
    return;
  }
  redirect("/dashboard");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/");
}
