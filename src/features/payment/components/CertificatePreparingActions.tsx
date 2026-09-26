"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Shown to the owner of a paid certificate that is still being prepared.
 * Retries fulfillment (idempotent, owner-only, never charges) and reloads the
 * authoritative state.
 */
export function CertificatePreparingActions({
  certificateId,
}: {
  certificateId: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const checkStatus = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/certificate/fulfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ certificateId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error?.message || "Could not check the certificate status");
      }
      router.refresh();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        onClick={checkStatus}
        disabled={loading}
        className="bg-surface border-border hover:bg-surface-elevated rounded-lg border px-6 py-3 font-bold transition-colors disabled:opacity-50"
      >
        {loading ? "Checking..." : "Check Certificate Status"}
      </button>
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}
