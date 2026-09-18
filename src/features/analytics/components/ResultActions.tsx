"use client";

import React, { useState } from "react";
import Link from "next/link";
import { CertificateCheckoutButton } from "@/features/payment/components/CertificateCheckoutButton";

interface ResultActionsProps {
  shareUrl: string;
  resultId: string;
  isCertificateEligible?: boolean;
  certificateId?: string | null;
}

export function ResultActions({
  shareUrl,
  resultId,
  isCertificateEligible,
  certificateId,
}: ResultActionsProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    // Only copy the relative path since we are in the browser
    // Or we can reconstruct the full URL
    const url =
      typeof window !== "undefined" ? `${window.location.origin}${shareUrl}` : shareUrl;
    navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(console.error);
  };

  return (
    <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
      <Link
        href="/"
        className="bg-accent hover:bg-tf-primary-700 rounded-lg px-6 py-3 font-medium text-white transition-colors"
      >
        Try Again
      </Link>

      <button
        onClick={handleCopy}
        className="bg-tf-background-100 border-border hover:bg-tf-neutral-800 text-foreground dark:text-foreground rounded-lg border px-6 py-3 font-medium transition-colors"
      >
        {copied ? "Copied!" : "Copy Link"}
      </button>

      <button
        onClick={() => {
          const url =
            typeof window !== "undefined"
              ? `${window.location.origin}${shareUrl}`
              : shareUrl;
          if (navigator.share) {
            navigator
              .share({
                title: "My Typing Result",
                text: "Check out my typing speed on TypeFlow!",
                url,
              })
              .catch(console.error);
          } else {
            handleCopy();
          }
        }}
        className="bg-tf-background-100 border-border hover:bg-tf-neutral-800 text-foreground dark:text-foreground rounded-lg border px-6 py-3 font-medium transition-colors"
      >
        Share Result
      </button>

      <button
        onClick={() => {
          const url =
            typeof window !== "undefined"
              ? `${window.location.origin}${shareUrl}`
              : shareUrl;
          const text = encodeURIComponent("Check out my typing speed on TypeFlow!");
          window.open(
            `https://twitter.com/intent/tweet?text=${text}&url=${encodeURIComponent(url)}`,
            "_blank",
            "noopener,noreferrer"
          );
        }}
        className="rounded-lg bg-[#1DA1F2] px-6 py-3 font-medium text-white transition-colors hover:bg-[#1a91da]"
      >
        Share on X
      </button>

      <Link
        href="/leaderboard"
        className="bg-tf-background-100 border-border hover:bg-tf-neutral-800 text-foreground dark:text-foreground rounded-lg border px-6 py-3 font-medium transition-colors"
      >
        View Leaderboard
      </Link>

      {certificateId ? (
        <Link
          href={`/certificate/verify?id=${certificateId}`}
          className="rounded-lg bg-green-600 px-6 py-3 font-medium text-white transition-colors hover:bg-green-700"
        >
          View Certificate
        </Link>
      ) : isCertificateEligible ? (
        <CertificateCheckoutButton resultId={resultId} />
      ) : null}
    </div>
  );
}
