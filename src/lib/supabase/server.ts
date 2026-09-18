/**
 * Supabase server client.
 *
 * Uses cookies() from Next.js for session management.
 * Must only be called from Server Components, Route Handlers, or Server Actions.
 */
import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getServerEnv } from "@/lib/env";

export async function createClient() {
  const cookieStore = await cookies();
  const env = getServerEnv();

  return createServerClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: {name: string, value: string, options: any}[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // The `setAll` method is called from a Server Component.
          // This can be ignored if you have middleware refreshing user sessions.
        }
      },
    },
  });
}

/**
 * Supabase admin client with service role key.
 * Only use for operations that require bypassing RLS.
 * NEVER expose this client or its key to the browser.
 */
export function createAdminClient() {
  const env = getServerEnv();
  return createSupabaseClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
