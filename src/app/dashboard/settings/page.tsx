import React from "react";
import { getAuthenticatedUser } from "@/server/services/auth.service";
import { db } from "@/server/db";
import { revalidatePath } from "next/cache";
import { Medal, ShieldCheck, Mail, User, Settings2 } from "lucide-react";

export default async function SettingsPage() {
  const user = await getAuthenticatedUser();
  if (!user) return null;

  const totalTests = await db.testResult.count({ where: { userId: user.id } });

  // Deterministic Achievements
  const achievements = [
    { name: "First Steps", desc: "Completed your first test", unlocked: totalTests >= 1 },
    { name: "Warming Up", desc: "Completed 10 tests", unlocked: totalTests >= 10 },
    { name: "Consistent", desc: "Completed 50 tests", unlocked: totalTests >= 50 },
    { name: "Dedicated", desc: "Completed 100 tests", unlocked: totalTests >= 100 },
  ];

  return (
    <div className="animate-fade-in mx-auto flex w-full max-w-4xl flex-col gap-10 pb-12">
      <div>
        <h1 className="mb-2 text-4xl font-black">Profile & Settings</h1>
        <p className="text-muted">
          Manage your account preferences and view your unlocked achievements.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        {/* PROFILE CARD */}
        <div className="bg-surface border-border h-min rounded-3xl border p-8 shadow-sm">
          <div className="mb-6 flex items-center gap-3">
            <User className="text-accent h-6 w-6" />
            <h2 className="text-2xl font-bold">Profile Details</h2>
          </div>

          <div className="space-y-6">
            <div>
              <label className="text-muted mb-2 block text-sm font-bold tracking-wider uppercase">
                Email Address
              </label>
              <div className="bg-background border-border flex items-center gap-3 rounded-xl border px-4 py-3 opacity-70">
                <Mail className="text-muted h-5 w-5" />
                <span className="font-medium">{user.email}</span>
              </div>
            </div>

            <div>
              <label className="text-muted mb-2 block text-sm font-bold tracking-wider uppercase">
                Display Name
              </label>
              <input
                type="text"
                readOnly
                value={user.displayName || ""}
                className="bg-background border-border text-foreground w-full cursor-not-allowed rounded-xl border px-4 py-3 font-medium outline-none"
                placeholder="No display name set"
              />
              <p className="text-muted mt-2 text-xs font-medium">
                Profile editing is currently managed via your Supabase provider.
              </p>
            </div>
          </div>
        </div>

        {/* PRIVACY SETTINGS */}
        <div className="bg-surface border-border h-min rounded-3xl border p-8 shadow-sm">
          <div className="mb-6 flex items-center gap-3">
            <Settings2 className="text-accent h-6 w-6" />
            <h2 className="text-2xl font-bold">Privacy</h2>
          </div>

          <form
            action={async (formData: FormData) => {
              "use server";
              const { db } = await import("@/server/db");
              const optOut = formData.get("leaderboardOptOut") === "on";
              await db.user.update({
                where: { id: user.id },
                data: { leaderboardOptOut: optOut },
              });
              revalidatePath("/dashboard/settings");
              revalidatePath("/leaderboard");
            }}
            className="space-y-6"
          >
            <div className="bg-background border-border flex items-start gap-4 rounded-xl border p-5">
              <input
                type="checkbox"
                id="leaderboardOptOut"
                name="leaderboardOptOut"
                defaultChecked={user.leaderboardOptOut}
                className="text-accent bg-background border-border focus:ring-accent mt-0.5 h-5 w-5 cursor-pointer rounded focus:ring-2"
              />
              <div>
                <label
                  htmlFor="leaderboardOptOut"
                  className="text-foreground mb-1 block cursor-pointer text-sm font-bold"
                >
                  Hide my results from public leaderboards
                </label>
                <p className="text-muted text-xs leading-relaxed">
                  If checked, your results will not appear on the global leaderboard. You
                  can still share your results directly using your unique verified share
                  links.
                </p>
              </div>
            </div>
            <button
              type="submit"
              className="bg-accent hover:bg-accent/90 text-accent-foreground shadow-accent/20 w-full rounded-xl px-6 py-3 text-sm font-bold shadow-lg transition-all"
            >
              Save Privacy Settings
            </button>
          </form>
        </div>
      </div>

      {/* ACHIEVEMENTS */}
      <div className="bg-surface border-border rounded-3xl border p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <Medal className="h-6 w-6 text-yellow-500" />
          <h2 className="text-2xl font-bold">Achievements</h2>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
          {achievements.map((ach, i) => (
            <div
              key={i}
              className={`rounded-2xl border p-5 transition-all ${ach.unlocked ? "bg-background border-accent shadow-glow shadow-accent/10" : "bg-surface-elevated/20 border-border opacity-50 grayscale"}`}
            >
              <div className="mb-2 flex items-start justify-between">
                <ShieldCheck
                  className={`h-6 w-6 ${ach.unlocked ? "text-accent" : "text-muted"}`}
                />
              </div>
              <h3 className="mb-1 font-bold">{ach.name}</h3>
              <p className="text-muted text-xs font-medium">{ach.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
