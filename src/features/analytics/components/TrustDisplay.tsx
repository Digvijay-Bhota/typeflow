import React from "react";
import { TestResultPublic } from "@/types/typing";

interface TrustDisplayProps {
  result: TestResultPublic;
}

export function TrustDisplay({ result }: TrustDisplayProps) {
  // If the result is eligible for certificate, it means it's a high trust tier and verified.
  if (result.isCertificateEligible) {
    return (
      <div className="flex items-center gap-2 rounded-full bg-green-50 px-3 py-1.5 text-sm text-green-600 dark:bg-green-900/20 dark:text-green-400">
        <span>✓</span>
        <span className="font-medium">
          Structurally validated event trace (semantic reconstruction pending)
        </span>
      </div>
    );
  }

  // By default, FREE tier tests are lower-trust
  return (
    <div className="text-muted bg-background dark:bg-background border-border dark:border-border flex items-center gap-2 rounded-full border px-3 py-1.5 text-center text-sm">
      <span>i</span>
      <span className="font-medium">
        Lower-trust browser metrics (server-controlled duration, client-advisory counts)
      </span>
    </div>
  );
}
