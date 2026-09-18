import React from "react";
import { getAuthenticatedUser } from "@/server/services/auth.service";

export default async function SettingsPage() {
  const user = await getAuthenticatedUser();
  if (!user) return null;

  return (
    <div className="flex flex-col gap-6 animate-fade-in max-w-2xl">
      <h1 className="text-3xl font-bold text-foreground dark:text-foreground">Settings</h1>

      <div className="bg-surface dark:bg-surface border border-border dark:border-border rounded-2xl p-6">
        <h2 className="text-xl font-bold mb-4">Profile</h2>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-tf-text-700 dark:text-tf-text-300 mb-1">Email</label>
            <input 
              type="text" 
              readOnly 
              value={user.email} 
              className="w-full px-4 py-2 bg-background dark:bg-background border border-border dark:border-border rounded-lg text-muted cursor-not-allowed"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-tf-text-700 dark:text-tf-text-300 mb-1">Display Name</label>
            <input 
              type="text" 
              readOnly 
              value={user.displayName || ""} 
              className="w-full px-4 py-2 bg-background dark:bg-background border border-border dark:border-border rounded-lg text-muted cursor-not-allowed"
              placeholder="No display name set"
            />
            <p className="mt-2 text-xs text-muted">Profile editing is deferred to a later phase.</p>
          </div>
        </div>
      </div>

      <div className="bg-surface dark:bg-surface border border-border dark:border-border rounded-2xl p-6 mt-6">
        <h2 className="text-xl font-bold mb-4">Privacy & Leaderboard</h2>
        <form action={async (formData: FormData) => {
          "use server";
          const { db } = await import("@/server/db");
          const { revalidatePath } = await import("next/cache");
          const optOut = formData.get("leaderboardOptOut") === "on";
          await db.user.update({
            where: { id: user.id },
            data: { leaderboardOptOut: optOut }
          });
          revalidatePath("/dashboard/settings");
          revalidatePath("/leaderboard");
        }}>
          <div className="flex items-center gap-3">
            <input 
              type="checkbox" 
              id="leaderboardOptOut" 
              name="leaderboardOptOut"
              defaultChecked={user.leaderboardOptOut}
              className="w-4 h-4 text-accent bg-background border-border rounded focus:ring-accent focus:ring-2"
            />
            <label htmlFor="leaderboardOptOut" className="text-sm font-medium text-tf-text-700 dark:text-tf-text-300">
              Hide my results from public leaderboards
            </label>
          </div>
          <p className="mt-2 text-xs text-muted mb-4">
            If checked, your results will not appear on the public leaderboard. You can still share your results directly using your unique share links.
          </p>
          <button 
            type="submit"
            className="px-4 py-2 bg-accent hover:bg-tf-primary-700 text-white rounded-lg font-medium transition-colors text-sm"
          >
            Save Privacy Settings
          </button>
        </form>
      </div>
    </div>
  );
}
