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
    <div className="animate-fade-in flex max-w-4xl flex-col gap-10 pb-12 w-full mx-auto">
      <div>
        <h1 className="text-4xl font-black mb-2">Profile & Settings</h1>
        <p className="text-muted">Manage your account preferences and view your unlocked achievements.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* PROFILE CARD */}
        <div className="bg-surface border-border rounded-3xl border p-8 shadow-sm h-min">
          <div className="flex items-center gap-3 mb-6">
             <User className="h-6 w-6 text-accent" />
             <h2 className="text-2xl font-bold">Profile Details</h2>
          </div>

          <div className="space-y-6">
            <div>
              <label className="text-muted mb-2 block text-sm font-bold uppercase tracking-wider">
                Email Address
              </label>
              <div className="flex items-center gap-3 bg-background border border-border px-4 py-3 rounded-xl opacity-70">
                <Mail className="h-5 w-5 text-muted" />
                <span className="font-medium">{user.email}</span>
              </div>
            </div>

            <div>
              <label className="text-muted mb-2 block text-sm font-bold uppercase tracking-wider">
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
        <div className="bg-surface border-border rounded-3xl border p-8 shadow-sm h-min">
          <div className="flex items-center gap-3 mb-6">
             <Settings2 className="h-6 w-6 text-accent" />
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
            <div className="flex items-start gap-4 bg-background border border-border p-5 rounded-xl">
              <input
                type="checkbox"
                id="leaderboardOptOut"
                name="leaderboardOptOut"
                defaultChecked={user.leaderboardOptOut}
                className="text-accent bg-background border-border focus:ring-accent h-5 w-5 rounded focus:ring-2 mt-0.5 cursor-pointer"
              />
              <div>
                <label
                  htmlFor="leaderboardOptOut"
                  className="text-foreground text-sm font-bold cursor-pointer block mb-1"
                >
                  Hide my results from public leaderboards
                </label>
                <p className="text-muted text-xs leading-relaxed">
                  If checked, your results will not appear on the global leaderboard. You can
                  still share your results directly using your unique verified share links.
                </p>
              </div>
            </div>
            <button
              type="submit"
              className="bg-accent hover:bg-accent/90 rounded-xl px-6 py-3 text-sm font-bold text-accent-foreground shadow-lg shadow-accent/20 transition-all w-full"
            >
              Save Privacy Settings
            </button>
          </form>
        </div>
      </div>

      {/* ACHIEVEMENTS */}
      <div className="bg-surface border-border rounded-3xl border p-8 shadow-sm">
         <div className="flex items-center gap-3 mb-6">
            <Medal className="h-6 w-6 text-yellow-500" />
            <h2 className="text-2xl font-bold">Achievements</h2>
         </div>
         <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            {achievements.map((ach, i) => (
              <div key={i} className={`border rounded-2xl p-5 transition-all ${ach.unlocked ? 'bg-background border-accent shadow-glow shadow-accent/10' : 'bg-surface-elevated/20 border-border opacity-50 grayscale'}`}>
                 <div className="flex justify-between items-start mb-2">
                   <ShieldCheck className={`h-6 w-6 ${ach.unlocked ? 'text-accent' : 'text-muted'}`} />
                 </div>
                 <h3 className="font-bold mb-1">{ach.name}</h3>
                 <p className="text-xs text-muted font-medium">{ach.desc}</p>
              </div>
            ))}
         </div>
      </div>
    </div>
  );
}
