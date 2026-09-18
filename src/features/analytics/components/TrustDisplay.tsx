import React from "react";
import { TestResultPublic } from "@/types/typing";

interface TrustDisplayProps {
  result: TestResultPublic;
}

export function TrustDisplay({ result }: TrustDisplayProps) {
  // If the result is eligible for certificate, it means it's a high trust tier and verified.
  if (result.isCertificateEligible) {
    return (
      <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-3 py-1.5 rounded-full">
        <span>✓</span>
        <span className="font-medium">Structurally validated event trace (semantic reconstruction pending)</span>
      </div>
    );
  }

  // By default, FREE tier tests are lower-trust
  return (
    <div className="flex items-center gap-2 text-sm text-muted bg-background dark:bg-background border border-border dark:border-border px-3 py-1.5 rounded-full text-center">
      <span>i</span>
      <span className="font-medium">Lower-trust browser metrics (server-controlled duration, client-advisory counts)</span>
    </div>
  );
}
