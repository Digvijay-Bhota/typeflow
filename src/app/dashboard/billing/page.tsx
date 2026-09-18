import React from "react";
import { requireAuthenticatedUser } from "@/server/services/auth.service";
import { getUserBillingInfo } from "@/server/services/subscription.service";
import { BillingClient } from "@/features/subscription/components/BillingClient";
import { constructMetadata } from "@/lib/seo";
import Link from "next/link";

export const dynamic = "force-dynamic";

export const metadata = constructMetadata({
  title: "Billing — TypeFlow",
  description: "Manage your TypeFlow Pro subscription",
  path: "/dashboard/billing",
  noindex: true,
});

export default async function BillingPage() {
  const user = await requireAuthenticatedUser();
  const billing = await getUserBillingInfo(user.id);

  return (
    <div className="animate-fade-in flex flex-col gap-8">
      <div>
        <h1 className="text-foreground dark:text-foreground text-3xl font-bold">
          Billing
        </h1>
        <p className="text-muted mt-1">Manage your subscription and billing details.</p>
      </div>

      <BillingClient
        plan={billing.plan}
        status={billing.status}
        isPro={billing.isPro}
        currentPeriodEnd={billing.currentPeriodEnd?.toISOString() ?? null}
        cancelAt={billing.cancelAt?.toISOString() ?? null}
        cancelledAt={billing.cancelledAt?.toISOString() ?? null}
      />

      <div className="text-tf-text-400 text-sm">
        <Link href="/pricing" className="text-accent hover:underline">
          View pricing details
        </Link>
      </div>
    </div>
  );
}
