/**
 * The subscription reconciler is read-only by construction: run against a
 * fake database that only implements reads (anything else throws and is
 * recorded), and a Razorpay layer whose mutating functions throw.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const reads: string[] = [];
  const blocked: string[] = [];
  const DAY = 86_400_000;
  const now = new Date("2026-10-10T00:00:00Z");
  const row = (id: string, status: string, providerSubscriptionId: string) => ({
    id,
    userId: `user-${id}`,
    providerSubscriptionId,
    providerPlanId: "plan_A",
    status,
    currentPeriodEnd: new Date(now.getTime() + 10 * DAY),
    cancelledAt: null,
    updatedAt: new Date(now.getTime() - 30 * DAY),
  });
  const rows = [
    row("a", "ACTIVE", "sub_a"),
    row("b", "TRIALING", "sub_b"),
    row("c", "ACTIVE", "sub_c"),
    row("d", "CANCELLED", "sub_d"),
  ];
  const stuck = [row("e", "PENDING_CREATION", "pending_e")];

  function delegate(name: string, impl: Record<string, (args: never) => unknown>) {
    return new Proxy(
      {},
      {
        get(_t, prop: string) {
          if (prop in impl) {
            return async (args: never) => {
              reads.push(`${name}.${prop}`);
              return impl[prop]!(args);
            };
          }
          return () => {
            blocked.push(`${name}.${prop}`);
            throw new Error(`blocked database call: ${name}.${prop}`);
          };
        },
      }
    );
  }
  const models: Record<string, unknown> = {
    subscription: delegate("subscription", {
      count: (args: { where: { status?: string } }) =>
        args.where.status === "PENDING_CREATION" ? stuck.length : rows.length,
      findMany: (args: { where: { status?: string } }) =>
        args.where.status === "PENDING_CREATION" ? stuck : rows,
    }),
    subscriptionEvent: delegate("subscriptionEvent", {
      count: () => 2,
      findMany: () => [{ providerSubscriptionId: "sub_orphan" }],
    }),
  };
  const db = new Proxy(models, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      // $transaction, $executeRaw, $queryRaw, other models…
      return delegate(prop, {});
    },
  });
  return { reads, blocked, db, now };
});

vi.mock("@/server/db", () => ({ db: h.db }));

const rz = vi.hoisted(() => ({
  fetchRazorpaySubscription: vi.fn(),
  createRazorpaySubscription: vi.fn(() => {
    throw new Error("create must not be called");
  }),
  cancelRazorpaySubscription: vi.fn(() => {
    throw new Error("cancel must not be called");
  }),
}));
vi.mock("@/server/services/razorpay.subscription.service", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/server/services/razorpay.subscription.service")
  >()),
  ...rz,
}));

import { RazorpayLookupError } from "@/server/services/razorpay.subscription.service";
import { reconcileSubscriptions } from "@/server/services/subscription.reconciliation.service";

beforeEach(() => {
  h.reads.length = 0;
  h.blocked.length = 0;
  rz.fetchRazorpaySubscription.mockReset();
  rz.fetchRazorpaySubscription.mockImplementation(async (id: string) => {
    const base = {
      id,
      planId: "plan_A",
      currentStart: null,
      currentEnd: null,
      endedAt: null,
      paidCount: 1,
      notesUserId: null,
    };
    if (id === "sub_a") return { ...base, status: "active" };
    if (id === "sub_b") return { ...base, status: "active" }; // missed activation
    if (id === "sub_c") throw new RazorpayLookupError("timeout");
    return { ...base, status: "active" }; // sub_d: cancellation pending
  });
});

describe("read-only by construction", () => {
  it("a report run uses only count and findMany, and attempts no write", async () => {
    const s = await reconcileSubscriptions({ mode: "report", now: h.now });
    expect(s.examined).toBe(4);
    expect(s.counts).toMatchObject({
      missed_activation: 1,
      provider_error: 1,
      stuck_creation: 1,
      unmatched_events: 2,
    });
    expect(h.blocked).toEqual([]);
    expect(new Set(h.reads)).toEqual(
      new Set([
        "subscription.count",
        "subscription.findMany",
        "subscriptionEvent.count",
        "subscriptionEvent.findMany",
      ])
    );
    expect(rz.createRazorpaySubscription).not.toHaveBeenCalled();
    expect(rz.cancelRazorpaySubscription).not.toHaveBeenCalled();
  });

  it("off mode makes no database call and no Razorpay call", async () => {
    const s = await reconcileSubscriptions({ mode: "off", now: h.now });
    expect(s.mode).toBe("off");
    expect(h.reads).toEqual([]);
    expect(h.blocked).toEqual([]);
    expect(rz.fetchRazorpaySubscription).not.toHaveBeenCalled();
  });

  it("an unknown mode value is treated as off", async () => {
    const s = await reconcileSubscriptions({ mode: "apply" as never, now: h.now });
    expect(s.mode).toBe("off");
    expect(h.reads).toEqual([]);
    expect(rz.fetchRazorpaySubscription).not.toHaveBeenCalled();
  });

  it("the service source contains no write, transition or provider-mutation call", () => {
    const src = readFileSync(
      join(process.cwd(), "src/server/services/subscription.reconciliation.service.ts"),
      "utf8"
    );
    expect(src).not.toMatch(
      /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(|\$transaction|\$executeRaw|\$queryRaw/
    );
    expect(src).not.toMatch(
      /createRazorpaySubscription|cancelRazorpaySubscription|processSubscriptionWebhook|applySubscriptionStateTransition|from "razorpay"/
    );
  });
});
