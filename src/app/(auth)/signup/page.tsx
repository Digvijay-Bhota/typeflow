import React from "react";
import { signup } from "../actions";
import Link from "next/link";
import { ClaimClient } from "@/features/auth/components/ClaimClient";

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ error?: string, claimToken?: string, claimed?: string }> }) {
  const params = await searchParams;

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 animate-fade-in">
      <div className="w-full max-w-md bg-background dark:bg-background border border-border dark:border-border rounded-2xl p-8">
        <h1 className="text-2xl font-bold text-center mb-6 text-foreground dark:text-foreground">Create an Account</h1>
        
        {params.error && (
          <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-3 rounded-lg mb-4 text-sm text-center">
            {params.error}
          </div>
        )}

        <form action={signup} className="flex flex-col gap-4">
          <input type="hidden" name="claimToken" value={params.claimToken || ""} />
          
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-tf-text-700 dark:text-tf-text-300">Display Name</label>
            <input 
              name="displayName" 
              type="text" 
              required 
              className="px-4 py-2 bg-surface dark:bg-surface border border-border dark:border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-tf-text-700 dark:text-tf-text-300">Email</label>
            <input 
              name="email" 
              type="email" 
              required 
              className="px-4 py-2 bg-surface dark:bg-surface border border-border dark:border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-tf-text-700 dark:text-tf-text-300">Password</label>
            <input 
              name="password" 
              type="password" 
              required 
              minLength={6}
              className="px-4 py-2 bg-surface dark:bg-surface border border-border dark:border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          <button type="submit" className="mt-2 w-full px-4 py-2 bg-accent hover:bg-tf-primary-700 text-white rounded-lg font-medium transition-colors">
            Sign Up
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-muted">
          Already have an account? <Link href={params.claimToken ? `/login?claimToken=${params.claimToken}` : "/login"} className="text-accent hover:underline">Sign in</Link>
        </div>
      </div>

      {params.claimed === "true" && params.claimToken && (
        <ClaimClient claimToken={params.claimToken} />
      )}
    </div>
  );
}
