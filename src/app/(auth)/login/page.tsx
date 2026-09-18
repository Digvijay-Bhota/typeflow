import React from "react";
import { login } from "../actions";
import Link from "next/link";
import { ClaimClient } from "@/features/auth/components/ClaimClient";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; claimToken?: string; claimed?: string }>;
}) {
  const params = await searchParams;

  return (
    <div className="animate-fade-in flex min-h-[60vh] flex-col items-center justify-center px-4">
      <div className="bg-background dark:bg-background border-border dark:border-border w-full max-w-md rounded-2xl border p-8">
        <h1 className="text-foreground dark:text-foreground mb-6 text-center text-2xl font-bold">
          Sign In
        </h1>

        {params.error && (
          <div className="mb-4 rounded-lg bg-red-50 p-3 text-center text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
            {params.error}
          </div>
        )}

        <form action={login} className="flex flex-col gap-4">
          <input type="hidden" name="claimToken" value={params.claimToken || ""} />

          <div className="flex flex-col gap-1">
            <label className="text-tf-text-700 dark:text-tf-text-300 text-sm font-medium">
              Email
            </label>
            <input
              name="email"
              type="email"
              required
              className="bg-surface dark:bg-surface border-border dark:border-border focus:ring-accent rounded-lg border px-4 py-2 focus:ring-2 focus:outline-none"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-tf-text-700 dark:text-tf-text-300 text-sm font-medium">
              Password
            </label>
            <input
              name="password"
              type="password"
              required
              className="bg-surface dark:bg-surface border-border dark:border-border focus:ring-accent rounded-lg border px-4 py-2 focus:ring-2 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            className="bg-accent hover:bg-tf-primary-700 mt-2 w-full rounded-lg px-4 py-2 font-medium text-white transition-colors"
          >
            Sign In
          </button>
        </form>

        <div className="text-muted mt-6 text-center text-sm">
          Don&apos;t have an account?{" "}
          <Link
            href={
              params.claimToken ? `/signup?claimToken=${params.claimToken}` : "/signup"
            }
            className="text-accent hover:underline"
          >
            Sign up
          </Link>
        </div>
      </div>

      {params.claimed === "true" && params.claimToken && (
        <ClaimClient claimToken={params.claimToken} />
      )}
    </div>
  );
}
