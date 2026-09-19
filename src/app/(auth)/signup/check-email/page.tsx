import React from "react";
import Link from "next/link";
import { Mail } from "lucide-react";

export default function CheckEmailPage() {
  return (
    <div className="animate-fade-in flex min-h-[60vh] flex-col items-center justify-center px-4">
      <div className="bg-background dark:bg-background border-border dark:border-border w-full max-w-md rounded-2xl border p-8 text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-blue-50 dark:bg-blue-900/20">
          <Mail className="h-8 w-8 text-blue-500 dark:text-blue-400" />
        </div>

        <h1 className="text-foreground dark:text-foreground mb-4 text-2xl font-bold">
          Check your email
        </h1>

        <p className="text-muted mb-8 text-sm leading-relaxed">
          We sent you a confirmation link. Please check your inbox and click the link to
          activate your account.
        </p>

        <Link
          href="/login"
          className="bg-accent hover:bg-tf-primary-700 block w-full rounded-lg px-4 py-2 font-medium text-white transition-colors"
        >
          Return to Sign In
        </Link>
      </div>
    </div>
  );
}
