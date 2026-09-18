"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export function GuestClaimBanner() {
  const [claimToken, setClaimToken] = useState<string | null>(null);

  useEffect(() => {
    const token = sessionStorage.getItem("tf_claim_token");
    if (token) {
      setClaimToken(token);
    }
  }, []);

  if (!claimToken) return null;

  return (
    <div className="bg-tf-primary-50 dark:bg-tf-primary-900/20 border-tf-primary-200 dark:border-tf-primary-800 flex w-full flex-col items-center justify-between gap-4 rounded-lg border p-4 sm:flex-row">
      <p className="text-tf-primary-900 dark:text-tf-primary-100 text-sm font-medium">
        Great job! Save this result to track your progress over time.
      </p>
      <div className="flex shrink-0 items-center gap-3">
        {/* We still pass it via URL to the login/signup pages because they are separate routes, but it's not exposed on the public result share URL */}
        <Link
          href={`/login?claimToken=${claimToken}`}
          className="text-tf-primary-700 dark:text-tf-primary-300 text-sm font-semibold hover:underline"
        >
          Sign In
        </Link>
        <Link
          href={`/signup?claimToken=${claimToken}`}
          className="bg-accent hover:bg-tf-primary-700 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors"
        >
          Create Account
        </Link>
      </div>
    </div>
  );
}
