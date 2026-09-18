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
        <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-xl p-4 text-sm">
          {error}
        </div>
      )}
      {successMessage && (
        <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300 rounded-xl p-4 text-sm">
          {successMessage}
        </div>
      )}

      {/* Current Plan Card */}
      <div className="bg-surface dark:bg-surface border border-border dark:border-border rounded-2xl p-6">
        <h2 className="text-lg font-bold mb-4">Current Plan</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-muted block mb-1">Plan</span>
            <span className="font-semibold text-foreground dark:text-foreground flex items-center gap-2">
              {plan === "PRO" ? (
                <>
                  Pro
                  <span className="text-xs font-bold bg-tf-primary-100 dark:bg-tf-primary-900 text-tf-primary-700 dark:text-tf-primary-300 px-2 py-0.5 rounded-full">
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
              <span className="text-muted block mb-1">Status</span>
              <span className={`font-semibold ${statusColor}`}>
                {statusLabel}
              </span>
            </div>
          )}
          {currentPeriodEnd && (
            <div>
              <span className="text-muted block mb-1">
                {isCancelling ? "Access until" : "Next renewal"}
              </span>
              <span className="font-semibold text-foreground dark:text-foreground">
                {formatDate(currentPeriodEnd)}
              </span>
            </div>
          )}
          {cancelledAt && (
            <div>
              <span className="text-muted block mb-1">Cancelled on</span>
              <span className="font-semibold text-foreground dark:text-foreground">
                {formatDate(cancelledAt)}
              </span>
            </div>
          )}
        </div>

        {/* Past due notice */}
        {isPastDue && (
          <div className="mt-4 bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-200 rounded-xl p-3 text-sm">
            Your last payment failed. Razorpay will retry automatically. You
            retain Pro access until{" "}
            <strong>{formatDate(currentPeriodEnd)}</strong>.
          </div>
        )}

        {/* Cancelling notice */}
        {isCancelling && (
          <div className="mt-4 bg-orange-50 dark:bg-orange-950 border border-orange-200 dark:border-orange-800 text-orange-800 dark:text-orange-200 rounded-xl p-3 text-sm">
            Your subscription is cancelled. You retain Pro access until{" "}
            <strong>{formatDate(cancelAt)}</strong>.
          </div>
        )}
      </div>

      {/* Actions */}
      {!isPro && (
        <div className="bg-surface dark:bg-surface border border-border dark:border-border rounded-2xl p-6">
          <h2 className="text-lg font-bold mb-2">Upgrade to Pro</h2>
          <p className="text-sm text-muted mb-4">
            Unlock advanced analytics, weak-key training, custom themes, and
            more.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => void handleUpgrade("monthly")}
              disabled={loading}
              className="flex-1 py-2.5 px-4 rounded-xl bg-accent text-white font-bold hover:bg-accent transition-colors disabled:opacity-50"
            >
              {loading ? "..." : "₹499/month"}
            </button>
            <button
              onClick={() => void handleUpgrade("yearly")}
              disabled={loading}
              className="flex-1 py-2.5 px-4 rounded-xl border border-tf-primary-500 text-accent dark:text-accent font-medium hover:bg-tf-primary-50 dark:hover:bg-tf-primary-950 transition-colors disabled:opacity-50"
            >
              {loading ? "..." : "₹3,999/year"}
            </button>
          </div>
        </div>
      )}

      {isPro && !isCancelling && (
        <div className="bg-surface dark:bg-surface border border-border dark:border-border rounded-2xl p-6">
          <h2 className="text-lg font-bold mb-2">Manage Subscription</h2>
          <p className="text-sm text-muted mb-4">
            Cancelling will keep Pro active until your current period ends.
          </p>
          <button
            onClick={() => void handleCancel()}
            disabled={loading}
            className="py-2.5 px-4 rounded-xl border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 text-sm font-medium hover:bg-red-50 dark:hover:bg-red-950 transition-colors disabled:opacity-50"
          >
            {loading ? "Processing..." : "Cancel subscription"}
          </button>
        </div>
      )}
    </div>
  );
}
