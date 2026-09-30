/**
 * Razorpay subscription webhooks against real Postgres: idempotency enforced by
 * the unique subscription_events.providerEventId, with no time-based keys.
 *
 * Payloads follow Razorpay's webhook shape (entity, account_id, event,
 * contains, payload.subscription.entity{ id, status, current_start?,
 * current_end? }, created_at).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { createHmac, randomBytes, randomUUID } from "crypto";
import { db } from "@/server/db";
import { __clearServerEnvForTesting } from "@/lib/env";
import { processSubscriptionWebhook } from "@/server/services/subscription.service";

vi.mock("@/server/services/auth.service", () => ({
  getAuthenticatedUser: vi.fn().mockResolvedValue(null),
}));

// Test-only placeholders for getServerEnv(), used only when the variable is
// not already provided (CI sets real test values). Restored after the file.
const TEST_ENV: Record<string, string> = {
  SUPABASE_URL: "http://localhost:54321",
  SUPABASE_ANON_KEY: "test-only-supabase-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "test-only-supabase-service-role-key",
  RAZORPAY_KEY_ID: "rzp_test_placeholder",
  RAZORPAY_KEY_SECRET: "test-only-razorpay-key-secret",
  RAZORPAY_WEBHOOK_SECRET: "test-only-razorpay-webhook-secret",
  APP_URL: "http://localhost:3000",
  SESSION_SECRET: "test-only-session-secret-not-for-production",
  CERTIFICATE_SIGNING_SECRET: "test-only-certificate-signing-secret-not-for-production",
};

beforeAll(() => {
  for (const [key, value] of Object.entries(TEST_ENV)) {
    if (!process.env[key]) vi.stubEnv(key, value);
  }
  __clearServerEnvForTesting();
});

afterAll(() => {
  vi.unstubAllEnvs();
  __clearServerEnvForTesting();
});

async function seedSubscription(
  status: "PENDING_CREATION" | "ACTIVE" = "PENDING_CREATION"
) {
  const tag = randomBytes(4).toString("hex");
  const user = await db.user.create({
    data: { authId: randomUUID(), email: `sub-${tag}@example.com` },
  });
  const sub = await db.subscription.create({
    data: { userId: user.id, providerSubscriptionId: `sub_${tag}`, status },
  });
  return {
    tag,
    subscriptionRowId: sub.id,
    providerSubscriptionId: sub.providerSubscriptionId!,
  };
}

function delivery(
  providerSubscriptionId: string,
  event: string,
  entity: { status: string; current_start?: number; current_end?: number }
) {
  const payload = {
    entity: "event",
    account_id: "acc_TEST000000001",
    event,
    contains: ["subscription"],
    payload: { subscription: { entity: { id: providerSubscriptionId, ...entity } } },
    created_at: 1790200000,
  };
  const raw = JSON.stringify(payload);
  const signature = createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET as string)
    .update(raw)
    .digest("hex");
  return { payload, raw, signature };
}

const deliver = (d: ReturnType<typeof delivery>, eventId?: string | null) =>
  processSubscriptionWebhook(d.payload, d.signature, d.raw, eventId);

const eventsFor = (providerSubscriptionId: string) =>
  db.subscriptionEvent.findMany({ where: { providerSubscriptionId } });

describe("subscription webhook — idempotency", () => {
  it("processes the same event delivered twice sequentially exactly once", async () => {
    const s = await seedSubscription();
    const d = delivery(s.providerSubscriptionId, "subscription.activated", {
      status: "active",
      current_end: 1792800000,
    });
    await deliver(d, `evt_seq_${s.tag}`);
    await deliver(d, `evt_seq_${s.tag}`);

    const events = await eventsFor(s.providerSubscriptionId);
    expect(events).toHaveLength(1);
    expect(events[0]!.providerEventId).toBe(`evt:evt_seq_${s.tag}`);
    const sub = await db.subscription.findUniqueOrThrow({
      where: { id: s.subscriptionRowId },
    });
    expect(sub.status).toBe("ACTIVE");
  });

  it("treats concurrent duplicate deliveries as duplicates, not errors", async () => {
    const s = await seedSubscription();
    const d = delivery(s.providerSubscriptionId, "subscription.activated", {
      status: "active",
    });

    const outcomes = await Promise.allSettled(
      Array.from({ length: 4 }, () => deliver(d, `evt_cc_${s.tag}`))
    );

    expect(outcomes.every((o) => o.status === "fulfilled")).toBe(true);
    expect(await eventsFor(s.providerSubscriptionId)).toHaveLength(1);
  });

  it("dedupes a redelivered event that has no current_end and no event-id header", async () => {
    // The old key fell back to Date.now() here, so every redelivery was "new".
    const s = await seedSubscription("ACTIVE");
    const d = delivery(s.providerSubscriptionId, "subscription.charged", {
      status: "active",
    });
    await deliver(d, null);
    await new Promise((r) => setTimeout(r, 5));
    await deliver(d, null);

    const events = await eventsFor(s.providerSubscriptionId);
    expect(events).toHaveLength(1);
    expect(events[0]!.providerEventId).toMatch(/^body:[0-9a-f]{64}$/);
  });

  it("does not collapse distinct renewal events for the same subscription", async () => {
    const s = await seedSubscription("ACTIVE");
    await deliver(
      delivery(s.providerSubscriptionId, "subscription.charged", {
        status: "active",
        current_end: 1792800000,
      }),
      `evt_r1_${s.tag}`
    );
    await deliver(
      delivery(s.providerSubscriptionId, "subscription.charged", {
        status: "active",
        current_end: 1795400000,
      }),
      `evt_r2_${s.tag}`
    );

    expect(await eventsFor(s.providerSubscriptionId)).toHaveLength(2);
    const sub = await db.subscription.findUniqueOrThrow({
      where: { id: s.subscriptionRowId },
    });
    expect(sub.currentPeriodEnd?.getTime()).toBe(1795400000 * 1000);
  });
});

// The client's own $transaction, captured before the spy below wraps it. The
// spy delegates to it (Prisma's client proxy needs the bound original) and is
// never restored: restoring deletes the property from that proxy.
const realTransaction = db.$transaction.bind(db) as (
  fn: (tx: unknown) => Promise<unknown>
) => Promise<unknown>;
const passThrough = ((fn: (tx: unknown) => Promise<unknown>) =>
  realTransaction(fn)) as never;
const transactionSpy = vi.spyOn(db, "$transaction").mockImplementation(passThrough);

type Method = (args: unknown) => Promise<unknown>;

/**
 * The transaction client with some model methods wrapped: `overrides[model]
 * [method]` receives the real method and returns its replacement.
 */
function overrideDelegates(
  tx: unknown,
  overrides: Record<string, Record<string, (original: Method) => Method>>
): unknown {
  const client = tx as Record<string | symbol, unknown>;
  const delegates = new Map<string | symbol, object>();
  for (const [model, methods] of Object.entries(overrides)) {
    const delegate = client[model] as Record<string, Method>;
    delegates.set(
      model,
      new Proxy(delegate, {
        get: (target, prop, receiver) => {
          const wrap = typeof prop === "string" ? methods[prop] : undefined;
          if (!wrap) return Reflect.get(target, prop, receiver);
          return wrap((args) => (target[prop as string] as Method).call(target, args));
        },
      })
    );
  }
  return new Proxy(client, {
    get: (target, prop, receiver) =>
      delegates.get(prop) ?? Reflect.get(target, prop, receiver),
  });
}

/**
 * Makes the next processing transaction fail on its subscription update — the
 * transition step, after the event has been claimed — like a dropped
 * connection or a transaction timeout would.
 */
function failNextTransition() {
  transactionSpy.mockImplementationOnce(((fn: (tx: unknown) => Promise<unknown>) =>
    realTransaction((tx) =>
      fn(
        overrideDelegates(tx, {
          subscription: {
            update: () => () =>
              Promise.reject(new Error("simulated transaction failure")),
          },
        })
      )
    )) as never);
}

/**
 * Instruments processing transactions until `restore()`:
 * - every one waits at its first query until `parties` transactions are open,
 *   so none can commit first and all of their claims race;
 * - records each claim's outcome (subscription_events rows updated: 1 = this
 *   delivery claimed the event, 0 = another already had) and counts the
 *   transition writes (subscription updates), which only a claim leads to.
 */
function raceProcessing(parties: number) {
  const claimCounts: number[] = [];
  let transitions = 0;
  let arrived = 0;
  let releaseAll!: () => void;
  const allArrived = new Promise<void>((resolve) => (releaseAll = resolve));

  const barrier = async () => {
    arrived += 1;
    if (arrived === parties) releaseAll();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(`only ${arrived} of ${parties} deliveries reached processing`)
          ),
        4_000
      );
    });
    try {
      await Promise.race([allArrived, timeout]);
    } finally {
      clearTimeout(timer);
    }
  };

  transactionSpy.mockImplementation(((fn: (tx: unknown) => Promise<unknown>) =>
    realTransaction((tx) =>
      fn(
        overrideDelegates(tx, {
          subscription: {
            findUnique: (original) => async (args) => {
              await barrier();
              return original(args);
            },
            update: (original) => async (args) => {
              transitions += 1;
              return original(args);
            },
          },
          subscriptionEvent: {
            updateMany: (original) => async (args) => {
              const result = (await original(args)) as { count: number };
              claimCounts.push(result.count);
              return result;
            },
          },
        })
      )
    )) as never);

  return {
    claimCounts,
    transitions: () => transitions,
    restore: () => transactionSpy.mockImplementation(passThrough),
  };
}

describe("subscription webhook — recovery after a failed delivery", () => {
  it("processes the redelivered event when the first delivery's processing failed", async () => {
    const s = await seedSubscription();
    const d = delivery(s.providerSubscriptionId, "subscription.activated", {
      status: "active",
      current_end: 1792800000,
    });

    // First delivery: the transition fails, so the route answers 500 and
    // Razorpay will retry the same event id.
    failNextTransition();
    await expect(deliver(d, `evt_rec_${s.tag}`)).rejects.toThrow(
      "simulated transaction failure"
    );

    let events = await eventsFor(s.providerSubscriptionId);
    expect(events).toHaveLength(1);
    expect(events[0]!.processedAt).toBeNull(); // the claim rolled back with it
    expect(
      (await db.subscription.findUniqueOrThrow({ where: { id: s.subscriptionRowId } }))
        .status
    ).toBe("PENDING_CREATION");

    // Redelivery of the same event: actually processed, not skipped.
    await deliver(d, `evt_rec_${s.tag}`);

    events = await eventsFor(s.providerSubscriptionId);
    expect(events).toHaveLength(1);
    expect(events[0]!.processedAt).not.toBeNull();
    expect(events[0]!.subscriptionId).toBe(s.subscriptionRowId);
    const sub = await db.subscription.findUniqueOrThrow({
      where: { id: s.subscriptionRowId },
    });
    expect(sub.status).toBe("ACTIVE");
    expect(sub.currentPeriodEnd?.getTime()).toBe(1792800000 * 1000);

    // Any later redelivery is a plain duplicate.
    const processedAt = events[0]!.processedAt;
    await deliver(d, `evt_rec_${s.tag}`);
    events = await eventsFor(s.providerSubscriptionId);
    expect(events).toHaveLength(1);
    expect(events[0]!.processedAt).toEqual(processedAt);
  });

  it("applies a failed event exactly once when four redeliveries race", async () => {
    const s = await seedSubscription("ACTIVE");
    const d = delivery(s.providerSubscriptionId, "subscription.cancelled", {
      status: "cancelled",
    });

    failNextTransition();
    await expect(deliver(d, `evt_rcc_${s.tag}`)).rejects.toThrow(
      "simulated transaction failure"
    );

    // Four redeliveries of the unprocessed event, all inside their processing
    // transactions before any of them claims it.
    const race = raceProcessing(4);
    let outcomes: PromiseSettledResult<void>[];
    try {
      outcomes = await Promise.allSettled(
        Array.from({ length: 4 }, () => deliver(d, `evt_rcc_${s.tag}`))
      );
    } finally {
      race.restore();
    }
    expect(outcomes.every((o) => o.status === "fulfilled")).toBe(true);

    // One delivery claimed and processed the event; the other three found it
    // claimed and skipped the transition.
    expect([...race.claimCounts].sort()).toEqual([0, 0, 0, 1]);
    expect(race.transitions()).toBe(1);

    const events = await eventsFor(s.providerSubscriptionId);
    expect(events).toHaveLength(1);
    expect(events[0]!.processedAt).not.toBeNull();
    const sub = await db.subscription.findUniqueOrThrow({
      where: { id: s.subscriptionRowId },
    });
    expect(sub.status).toBe("CANCELLED");
    expect(sub.cancelledAt).not.toBeNull();
  });
});
