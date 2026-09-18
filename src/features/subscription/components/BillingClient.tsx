"use client";

import React, { useState } from "react";
import type { SubscriptionInterval } from "@/lib/constants";

interface BillingClientProps {
  plan: string;
  status: string | null;
  isPro: boolean;
  currentPeriodEnd: string | null;
  cancelAt: string | null;
  cancelledAt: string | null;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function BillingClient({
  plan,
  status,
  isPro,
  currentPeriodEnd,
  cancelAt,
  cancelledAt,
}: BillingClientProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const isCancelling = status === "CANCELLED" && cancelAt != null;
  const isPastDue = status === "PAST_DUE";

  async function handleUpgrade(interval: SubscriptionInterval) {
    setLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const res = await fetch("/api/subscription/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // SECURITY: Only send interval. Server determines price/plan/userId.
        body: JSON.stringify({ interval }),
      });

      const data = (await res.json()) as {
        shortUrl?: string;
        error?: { message: string };
      };

      if (!res.ok) {
        setError(data.error?.message ?? "Failed to start subscription");
        return;
      }

      if (data.shortUrl) {
        // Redirect to Razorpay hosted checkout
        window.location.href = data.shortUrl;
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCancel() {
    if (
      !window.confirm(
        "Cancel your Pro subscription? You will retain access until the end of your current billing period."
      )
    ) {
      return;
    }

    setLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const res = await fetch("/api/subscription/cancel", { method: "POST" });
      const data = (await res.json()) as {
        message?: string;
        error?: { message: string };
      };

      if (!res.ok) {
        setError(data.error?.message ?? "Failed to cancel subscription");
        return;
      }

      setSuccessMessage(
        data.message ??
          "Subscription cancelled. You retain access until your billing period ends."
      );
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const statusLabel =
    {
      TRIALING: "Trialing",
      ACTIVE: "Active",
      PAST_DUE: "Past Due — payment pending",
      CANCELLED: "Cancelled",
      EXPIRED: "Expired",
    }[status ?? ""] ?? "—";

  const statusColor =
    {
      TRIALING: "text-blue-600 dark:text-blue-400",
      ACTIVE: "text-green-600 dark:text-green-400",
      PAST_DUE: "text-yellow-600 dark:text-yellow-400",
      CANCELLED: "text-orange-600 dark:text-orange-400",
      EXPIRED: "text-tf-text-400",
    }[status ?? ""] ?? "text-tf-text-400";

  return (
    <div className="space-y-6">
      {/* Feedback */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}
      {successMessage && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
          {successMessage}
        </div>
      )}

      {/* Current Plan Card */}
      <div className="bg-surface dark:bg-surface border-border dark:border-border rounded-2xl border p-6">
        <h2 className="mb-4 text-lg font-bold">Current Plan</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-muted mb-1 block">Plan</span>
            <span className="text-foreground dark:text-foreground flex items-center gap-2 font-semibold">
              {plan === "PRO" ? (
                <>
                  Pro
                  <span className="bg-tf-primary-100 dark:bg-tf-primary-900 text-tf-primary-700 dark:text-tf-primary-300 rounded-full px-2 py-0.5 text-xs font-bold">
                    PRO
                  </span>
                </>
              ) : (
                "Free"
              )}
            </span>
          </div>
          {status && (
            <div>
              <span className="text-muted mb-1 block">Status</span>
              <span className={`font-semibold ${statusColor}`}>{statusLabel}</span>
            </div>
          )}
          {currentPeriodEnd && (
            <div>
              <span className="text-muted mb-1 block">
                {isCancelling ? "Access until" : "Next renewal"}
              </span>
              <span className="text-foreground dark:text-foreground font-semibold">
                {formatDate(currentPeriodEnd)}
              </span>
            </div>
          )}
          {cancelledAt && (
            <div>
              <span className="text-muted mb-1 block">Cancelled on</span>
              <span className="text-foreground dark:text-foreground font-semibold">
                {formatDate(cancelledAt)}
              </span>
            </div>
          )}
        </div>

        {/* Past due notice */}
        {isPastDue && (
          <div className="mt-4 rounded-xl border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-200">
            Your last payment failed. Razorpay will retry automatically. You retain Pro
            access until <strong>{formatDate(currentPeriodEnd)}</strong>.
          </div>
        )}

        {/* Cancelling notice */}
        {isCancelling && (
          <div className="mt-4 rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-200">
            Your subscription is cancelled. You retain Pro access until{" "}
            <strong>{formatDate(cancelAt)}</strong>.
          </div>
        )}
      </div>

      {/* Actions */}
      {!isPro && (
        <div className="bg-surface dark:bg-surface border-border dark:border-border rounded-2xl border p-6">
          <h2 className="mb-2 text-lg font-bold">Upgrade to Pro</h2>
          <p className="text-muted mb-4 text-sm">
            Unlock advanced analytics, weak-key training, custom themes, and more.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => void handleUpgrade("monthly")}
              disabled={loading}
              className="bg-accent hover:bg-accent flex-1 rounded-xl px-4 py-2.5 font-bold text-white transition-colors disabled:opacity-50"
            >
              {loading ? "..." : "₹499/month"}
            </button>
            <button
              onClick={() => void handleUpgrade("yearly")}
              disabled={loading}
              className="border-tf-primary-500 text-accent dark:text-accent hover:bg-tf-primary-50 dark:hover:bg-tf-primary-950 flex-1 rounded-xl border px-4 py-2.5 font-medium transition-colors disabled:opacity-50"
            >
              {loading ? "..." : "₹3,999/year"}
            </button>
          </div>
        </div>
      )}

      {isPro && !isCancelling && (
        <div className="bg-surface dark:bg-surface border-border dark:border-border rounded-2xl border p-6">
          <h2 className="mb-2 text-lg font-bold">Manage Subscription</h2>
          <p className="text-muted mb-4 text-sm">
            Cancelling will keep Pro active until your current period ends.
          </p>
          <button
            onClick={() => void handleCancel()}
            disabled={loading}
            className="rounded-xl border border-red-300 px-4 py-2.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950"
          >
            {loading ? "Processing..." : "Cancel subscription"}
          </button>
        </div>
      )}
    </div>
  );
}
