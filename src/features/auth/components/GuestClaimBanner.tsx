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
    <div className="w-full bg-tf-primary-50 dark:bg-tf-primary-900/20 border border-tf-primary-200 dark:border-tf-primary-800 rounded-lg p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
      <p className="text-sm text-tf-primary-900 dark:text-tf-primary-100 font-medium">
        Great job! Save this result to track your progress over time.
      </p>
      <div className="flex items-center gap-3 shrink-0">
        {/* We still pass it via URL to the login/signup pages because they are separate routes, but it's not exposed on the public result share URL */}
        <Link href={`/login?claimToken=${claimToken}`} className="text-sm text-tf-primary-700 dark:text-tf-primary-300 font-semibold hover:underline">Sign In</Link>
        <Link href={`/signup?claimToken=${claimToken}`} className="text-sm bg-accent hover:bg-tf-primary-700 text-white px-4 py-2 rounded-lg font-medium transition-colors">Create Account</Link>
      </div>
    </div>
  );
}
