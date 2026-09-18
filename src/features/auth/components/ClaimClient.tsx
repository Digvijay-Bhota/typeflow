"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function ClaimClient({ claimToken }: { claimToken: string }) {
  const router = useRouter();
  const [status, setStatus] = useState("Claiming your result...");
  const hasRun = useRef(false);

  useEffect(() => {
    if (hasRun.current) return;
    hasRun.current = true;

    async function claim() {
      try {
        const res = await fetch("/api/result/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ claimToken })
        });
        
        if (res.ok) {
          const data = await res.json();
          setStatus("Result claimed successfully!");
          sessionStorage.removeItem("tf_claim_token");
          setTimeout(() => {
            router.push(`/result/${data.shareId}`);
          }, 1000);
        } else {
          setStatus("Failed to claim result or already claimed.");
          setTimeout(() => {
            router.push("/dashboard");
          }, 2000);
        }
      } catch {
        setStatus("An error occurred.");
      }
    }
    claim();
  }, [claimToken, router]);

  return (
    <div className="fixed bottom-4 right-4 bg-background text-white px-4 py-3 rounded-lg shadow-lg animate-fade-in z-50">
      {status}
    </div>
  );
}
