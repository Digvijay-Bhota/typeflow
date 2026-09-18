import React from "react";
import { getAuthenticatedUser } from "@/server/services/auth.service";

export default async function SettingsPage() {
  const user = await getAuthenticatedUser();
  if (!user) return null;

  return (
    <div className="animate-fade-in flex max-w-2xl flex-col gap-6">
      <h1 className="text-foreground dark:text-foreground text-3xl font-bold">
        Settings
      </h1>

      <div className="bg-surface dark:bg-surface border-border dark:border-border rounded-2xl border p-6">
        <h2 className="mb-4 text-xl font-bold">Profile</h2>

        <div className="space-y-4">
          <div>
            <label className="text-tf-text-700 dark:text-tf-text-300 mb-1 block text-sm font-medium">
              Email
            </label>
            <input
              type="text"
              readOnly
              value={user.email}
              className="bg-background dark:bg-background border-border dark:border-border text-muted w-full cursor-not-allowed rounded-lg border px-4 py-2"
            />
          </div>

          <div>
            <label className="text-tf-text-700 dark:text-tf-text-300 mb-1 block text-sm font-medium">
              Display Name
            </label>
            <input
              type="text"
              readOnly
              value={user.displayName || ""}
              className="bg-background dark:bg-background border-border dark:border-border text-muted w-full cursor-not-allowed rounded-lg border px-4 py-2"
              placeholder="No display name set"
            />
            <p className="text-muted mt-2 text-xs">
              Profile editing is deferred to a later phase.
            </p>
          </div>
        </div>
      </div>

      <div className="bg-surface dark:bg-surface border-border dark:border-border mt-6 rounded-2xl border p-6">
        <h2 className="mb-4 text-xl font-bold">Privacy & Leaderboard</h2>
        <form
          action={async (formData: FormData) => {
            "use server";
            const { db } = await import("@/server/db");
            const { revalidatePath } = await import("next/cache");
            const optOut = formData.get("leaderboardOptOut") === "on";
            await db.user.update({
              where: { id: user.id },
              data: { leaderboardOptOut: optOut },
            });
            revalidatePath("/dashboard/settings");
            revalidatePath("/leaderboard");
          }}
        >
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="leaderboardOptOut"
              name="leaderboardOptOut"
              defaultChecked={user.leaderboardOptOut}
              className="text-accent bg-background border-border focus:ring-accent h-4 w-4 rounded focus:ring-2"
            />
            <label
              htmlFor="leaderboardOptOut"
              className="text-tf-text-700 dark:text-tf-text-300 text-sm font-medium"
            >
              Hide my results from public leaderboards
            </label>
          </div>
          <p className="text-muted mt-2 mb-4 text-xs">
            If checked, your results will not appear on the public leaderboard. You can
            still share your results directly using your unique share links.
          </p>
          <button
            type="submit"
            className="bg-accent hover:bg-tf-primary-700 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors"
          >
            Save Privacy Settings
          </button>
        </form>
      </div>
    </div>
  );
}
