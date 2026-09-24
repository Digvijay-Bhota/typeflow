"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { CERTIFICATE_PRICE_INR } from "@/lib/constants";

/** CERTIFICATE_PRICE_INR is in paise. */
const PRICE_LABEL = `₹${(CERTIFICATE_PRICE_INR / 100).toLocaleString("en-IN")}`;

interface CertificateCheckoutButtonProps {
  resultId: string;
}

interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  handler: (response: unknown) => void;
  theme?: {
    color: string;
  };
}

interface RazorpayInstance {
  on: (event: string, handler: (response: unknown) => void) => void;
  open: () => void;
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

export function CertificateCheckoutButton({ resultId }: CertificateCheckoutButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paid, setPaid] = useState(false);
  const router = useRouter();

  const loadRazorpayScript = () => {
    return new Promise((resolve) => {
      if (window.Razorpay) {
        resolve(true);
        return;
      }
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });
  };

  const handleCheckout = async () => {
    try {
      setLoading(true);
      setError(null);

      // 1. Issue certificate
      const issueRes = await fetch("/api/certificate/issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resultId }),
      });
      const issueData = await issueRes.json();
      if (!issueRes.ok)
        throw new Error(
          issueData.error?.message || "Failed to create certificate record"
        );

      const { certificateId } = issueData;

      // 2. Create order
      const res = await fetch("/api/payment/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ certificateId }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || "Failed to create order");
      }

      const scriptLoaded = await loadRazorpayScript();
      if (!scriptLoaded) {
        throw new Error("Razorpay SDK failed to load");
      }

      const options = {
        key: data.keyId,
        amount: data.amount,
        currency: data.currency,
        name: "TypeFlow",
        description: "Verified Typing Certificate",
        order_id: data.orderId,
        handler: function (_response: unknown) {
          // The client callback proves nothing: the signed webhook records the
          // capture and fulfils the certificate. Stop offering checkout and
          // reload the server's certificate state.
          setPaid(true);
          router.refresh();
        },
        theme: {
          color: "#3B82F6",
        },
      };

      const Razorpay = window.Razorpay;
      if (!Razorpay) throw new Error("Razorpay not loaded");

      const rzp = new Razorpay(options);
      rzp.on("payment.failed", function (_response: unknown) {
        setError("Payment failed. Please try again.");
      });
      rzp.open();
    } catch (err: unknown) {
      setError((err as Error).message || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  if (paid) {
    return (
      <p className="max-w-xs text-center text-sm font-medium">
        Payment received. Your certificate is being prepared.
      </p>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        onClick={handleCheckout}
        disabled={loading}
        className="rounded-lg bg-amber-500 px-6 py-3 font-bold text-white transition-colors hover:bg-amber-600 disabled:opacity-50"
      >
        {loading ? "Processing..." : `Get Verified Certificate (${PRICE_LABEL})`}
      </button>
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}
