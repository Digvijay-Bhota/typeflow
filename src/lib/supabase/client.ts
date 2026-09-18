/**
 * Supabase browser client.
 *
 * Uses @supabase/ssr for Next.js App Router compatibility.
 * Safe to import in client components.
 */
import { createBrowserClient } from "@supabase/ssr";
import { clientEnv } from "@/lib/env";

export function createClient() {
  return createBrowserClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}
