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

export function ResultActions({ shareUrl, resultId, isCertificateEligible, certificateId }: ResultActionsProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    // Only copy the relative path since we are in the browser
    // Or we can reconstruct the full URL
    const url = typeof window !== 'undefined' ? `${window.location.origin}${shareUrl}` : shareUrl;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(console.error);
  };

  return (
    <div className="flex flex-wrap items-center justify-center gap-4 mt-8">
      <Link 
        href="/"
        className="px-6 py-3 bg-accent hover:bg-tf-primary-700 text-white rounded-lg font-medium transition-colors"
      >
        Try Again
      </Link>

      <button
        onClick={handleCopy}
        className="px-6 py-3 bg-tf-background-100 border border-border hover:bg-tf-neutral-800 text-foreground dark:text-foreground rounded-lg font-medium transition-colors"
      >
        {copied ? "Copied!" : "Copy Link"}
      </button>

      <button
        onClick={() => {
          const url = typeof window !== 'undefined' ? `${window.location.origin}${shareUrl}` : shareUrl;
          if (navigator.share) {
            navigator.share({
              title: "My Typing Result",
              text: "Check out my typing speed on TypeFlow!",
              url
            }).catch(console.error);
          } else {
            handleCopy();
          }
        }}
        className="px-6 py-3 bg-tf-background-100 border border-border hover:bg-tf-neutral-800 text-foreground dark:text-foreground rounded-lg font-medium transition-colors"
      >
        Share Result
      </button>

      <button
        onClick={() => {
          const url = typeof window !== 'undefined' ? `${window.location.origin}${shareUrl}` : shareUrl;
          const text = encodeURIComponent("Check out my typing speed on TypeFlow!");
          window.open(`https://twitter.com/intent/tweet?text=${text}&url=${encodeURIComponent(url)}`, '_blank', 'noopener,noreferrer');
        }}
        className="px-6 py-3 bg-[#1DA1F2] hover:bg-[#1a91da] text-white rounded-lg font-medium transition-colors"
      >
        Share on X
      </button>

      <Link 
        href="/leaderboard"
        className="px-6 py-3 bg-tf-background-100 border border-border hover:bg-tf-neutral-800 text-foreground dark:text-foreground rounded-lg font-medium transition-colors"
      >
        View Leaderboard
      </Link>

      {certificateId ? (
        <Link 
          href={`/certificate/verify?id=${certificateId}`}
          className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors"
        >
          View Certificate
        </Link>
      ) : isCertificateEligible ? (
        <CertificateCheckoutButton resultId={resultId} />
      ) : null}
    </div>
  );
}
