import { createClient } from "@/lib/supabase/server";
import { db } from "@/server/db";

export async function getAuthenticatedUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  
  if (error || !user) return null;

  // Sync to Prisma User (create if not exists)
  // We use findUnique first because it's fast. If missing, we use upsert to avoid race conditions.
  let dbUser = await db.user.findUnique({ where: { authId: user.id } });
  
  if (!dbUser) {
    dbUser = await db.user.upsert({
      where: { authId: user.id },
      update: {},
      create: {
        authId: user.id,
        email: user.email!,
        displayName: user.user_metadata?.full_name || null,
        avatarUrl: user.user_metadata?.avatar_url || null,
      },
    });
  }
  
  return dbUser;
}

export async function requireAuthenticatedUser() {
  const user = await getAuthenticatedUser();
  if (!user) throw new Error("Unauthorized");
  return user;
}
