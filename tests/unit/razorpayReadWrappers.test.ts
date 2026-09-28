/**
 * The read-only Razorpay wrappers used by payment reconciliation: mapping of
 * SDK-shaped entities (as the Razorpay API returns them) to the internal
 * snapshots, payment-list and refund pagination, and that no write method is
 * ever called.
 * The SDK is mocked; fixtures follow Razorpay's documented entity shapes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const sdk = vi.hoisted(() => {
  const forbidden = (name: string) =>
    vi.fn(() => {
      throw new Error(`${name} must never be called by reconciliation`);
    });
  return {
    orders: { fetchPayments: vi.fn(), create: forbidden("orders.create") },
    payments: {
      all: vi.fn(),
      fetch: vi.fn(),
      fetchMultipleRefund: vi.fn(),
      capture: forbidden("payments.capture"),
      refund: forbidden("payments.refund"),
    },
    refunds: { edit: forbidden("refunds.edit") },
  };
});

vi.mock("razorpay", () => ({ default: vi.fn(() => sdk) }));
vi.mock("@/lib/env", () => ({
  getServerEnv: () => ({ RAZORPAY_KEY_ID: "rzp_test_fake", RAZORPAY_KEY_SECRET: "fake" }),
}));

import {
  fetchRazorpayOrderPayments,
  fetchRazorpayPayment,
  fetchRazorpayPaymentRefunds,
  fetchRazorpayPaymentsCreatedBetween,
} from "@/server/services/razorpay.service";

/** A payment entity as GET /v1/payments/:id returns it (fake values). */
function sdkPayment(over: Record<string, unknown> = {}) {
  return {
    id: "pay_FAKE00000001",
    entity: "payment",
    amount: 29900,
    currency: "INR",
    status: "captured",
    order_id: "order_FAKE00000001",
    invoice_id: null,
    international: false,
    method: "upi",
    amount_refunded: 0,
    refund_status: null,
    captured: true,
    description: "Verified Typing Certificate",
    card_id: null,
    bank: null,
    wallet: null,
    vpa: "customer@fakebank",
    email: "customer@example.test",
    contact: "+910000000000",
    notes: [],
    fee: 708,
    tax: 108,
    error_code: null,
    error_description: null,
    created_at: 1790200000,
    ...over,
  };
}

/** A refund entity as GET /v1/payments/:id/refunds returns it (fake values). */
function sdkRefund(i: number, over: Record<string, unknown> = {}) {
  return {
    id: `rfnd_FAKE${String(i).padStart(8, "0")}`,
    entity: "refund",
    amount: 29900,
    receipt: null,
    currency: "INR",
    payment_id: "pay_FAKE00000001",
    notes: [],
    acquirer_data: { rrn: null },
    created_at: 1790200500,
    batch_id: null,
    status: "processed",
    speed_processed: "normal",
    speed_requested: "normal",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("payment snapshot mapping", () => {
  it("maps a captured payment, keeping only the fields reconciliation needs", async () => {
    sdk.payments.fetch.mockResolvedValueOnce(sdkPayment());
    const p = await fetchRazorpayPayment("pay_FAKE00000001");
    expect(p).toEqual({
      id: "pay_FAKE00000001",
      orderId: "order_FAKE00000001",
      status: "captured",
      amount: 29900,
      currency: "INR",
      captured: true,
      amountRefunded: 0,
      refundStatus: null,
    });
    // No customer details are carried over.
    expect(JSON.stringify(p)).not.toMatch(/example\.test|fakebank|\+91/);
    expect(sdk.payments.fetch).toHaveBeenCalledWith("pay_FAKE00000001");
  });

  it.each([
    ["JSON null", null, null],
    ['the string "null" (the SDK type)', "null", null],
    ['"partial"', "partial", "partial"],
    ['"full"', "full", "full"],
  ])("refund_status %s", async (_label, value, expected) => {
    sdk.payments.fetch.mockResolvedValueOnce(sdkPayment({ refund_status: value }));
    expect((await fetchRazorpayPayment("pay_x")).refundStatus).toBe(expected);
  });

  it("maps a fully refunded payment", async () => {
    sdk.payments.fetch.mockResolvedValueOnce(
      sdkPayment({ status: "refunded", amount_refunded: 29900, refund_status: "full" })
    );
    expect(await fetchRazorpayPayment("pay_x")).toMatchObject({
      status: "refunded",
      captured: true,
      amountRefunded: 29900,
      refundStatus: "full",
    });
  });

  it("converts numeric strings and defaults missing optional fields", async () => {
    const raw: Record<string, unknown> = sdkPayment({ amount: "29900", order_id: null });
    delete raw.amount_refunded;
    delete raw.refund_status;
    sdk.payments.fetch.mockResolvedValueOnce(raw);
    expect(await fetchRazorpayPayment("pay_x")).toMatchObject({
      amount: 29900,
      orderId: null,
      amountRefunded: 0,
      refundStatus: null,
    });
  });

  it("treats anything but captured === true as not captured", async () => {
    sdk.payments.fetch.mockResolvedValueOnce(
      sdkPayment({ status: "authorized", captured: false })
    );
    expect((await fetchRazorpayPayment("pay_x")).captured).toBe(false);
    sdk.payments.fetch.mockResolvedValueOnce(sdkPayment({ captured: "true" }));
    expect((await fetchRazorpayPayment("pay_x")).captured).toBe(false);
  });

  it("lists an order's payments", async () => {
    sdk.orders.fetchPayments.mockResolvedValueOnce({
      entity: "collection",
      count: 2,
      items: [
        sdkPayment({ id: "pay_A", status: "failed", captured: false }),
        sdkPayment({ id: "pay_B" }),
      ],
    });
    const list = await fetchRazorpayOrderPayments("order_FAKE00000001");
    expect(list.map((p) => [p.id, p.status, p.captured])).toEqual([
      ["pay_A", "failed", false],
      ["pay_B", "captured", true],
    ]);
    expect(sdk.orders.fetchPayments).toHaveBeenCalledWith("order_FAKE00000001");
  });
});

describe("refund snapshot mapping and pagination", () => {
  it("maps refunds of every status", async () => {
    sdk.payments.fetchMultipleRefund.mockResolvedValueOnce({
      entity: "collection",
      count: 3,
      items: [
        sdkRefund(1),
        sdkRefund(2, { status: "pending", amount: "100" }),
        sdkRefund(3, { status: "failed", payment_id: undefined }),
      ],
    });
    expect(await fetchRazorpayPaymentRefunds("pay_FAKE00000001")).toEqual([
      {
        id: "rfnd_FAKE00000001",
        paymentId: "pay_FAKE00000001",
        status: "processed",
        amount: 29900,
        currency: "INR",
      },
      {
        id: "rfnd_FAKE00000002",
        paymentId: "pay_FAKE00000001",
        status: "pending",
        amount: 100,
        currency: "INR",
      },
      {
        id: "rfnd_FAKE00000003",
        paymentId: null,
        status: "failed",
        amount: 29900,
        currency: "INR",
      },
    ]);
    expect(sdk.payments.fetchMultipleRefund).toHaveBeenCalledWith("pay_FAKE00000001", {
      count: 100,
      skip: 0,
    });
  });

  it("reads every page", async () => {
    const page = (from: number, n: number) => ({
      entity: "collection",
      count: n,
      items: Array.from({ length: n }, (_, i) => sdkRefund(from + i, { amount: 1 })),
    });
    sdk.payments.fetchMultipleRefund
      .mockResolvedValueOnce(page(0, 100))
      .mockResolvedValueOnce(page(100, 5));

    const refunds = await fetchRazorpayPaymentRefunds("pay_x");
    expect(refunds).toHaveLength(105);
    expect(sdk.payments.fetchMultipleRefund).toHaveBeenNthCalledWith(2, "pay_x", {
      count: 100,
      skip: 100,
    });
  });

  it("throws instead of returning a truncated list", async () => {
    sdk.payments.fetchMultipleRefund.mockResolvedValue({
      entity: "collection",
      count: 100,
      items: Array.from({ length: 100 }, (_, i) => sdkRefund(i, { amount: 1 })),
    });
    await expect(fetchRazorpayPaymentRefunds("pay_x")).rejects.toThrow(
      "Too many refunds"
    );
    expect(sdk.payments.fetchMultipleRefund).toHaveBeenCalledTimes(10);
  });
});

describe("payments created in a time range (5C-10 scan)", () => {
  const from = new Date("2026-09-21T10:00:00.400Z");
  const to = new Date("2026-09-28T10:00:00.400Z");
  const range = {
    from: Math.floor(from.getTime() / 1000),
    to: Math.ceil(to.getTime() / 1000),
  };
  const page = (start: number, n: number) => ({
    entity: "collection",
    count: n,
    items: Array.from({ length: n }, (_, i) =>
      sdkPayment({ id: `pay_${start + i}`, order_id: `order_${start + i}` })
    ),
  });

  it("maps every payment in the range with whole-second bounds covering it", async () => {
    sdk.payments.all.mockResolvedValueOnce({
      entity: "collection",
      count: 3,
      items: [
        sdkPayment({ id: "pay_A", status: "authorized", captured: false }),
        sdkPayment({ id: "pay_B" }),
        sdkPayment({ id: "pay_C", status: "failed", captured: false, order_id: null }),
      ],
    });
    const list = await fetchRazorpayPaymentsCreatedBetween(from, to);
    expect(list.map((p) => [p.id, p.orderId, p.status, p.captured])).toEqual([
      ["pay_A", "order_FAKE00000001", "authorized", false],
      ["pay_B", "order_FAKE00000001", "captured", true],
      ["pay_C", null, "failed", false],
    ]);
    // No customer details are carried over.
    expect(JSON.stringify(list)).not.toMatch(/example\.test|fakebank|\+91/);
    expect(sdk.payments.all).toHaveBeenCalledWith({ ...range, count: 100, skip: 0 });
    // Rounded outwards: the sub-second edges of the window stay inside.
    expect(range).toEqual({ from: 1789984800, to: 1790589601 });
  });

  it("reads every page with the same bounds", async () => {
    sdk.payments.all
      .mockResolvedValueOnce(page(0, 100))
      .mockResolvedValueOnce(page(100, 7));
    expect(await fetchRazorpayPaymentsCreatedBetween(from, to)).toHaveLength(107);
    expect(sdk.payments.all).toHaveBeenNthCalledWith(2, {
      ...range,
      count: 100,
      skip: 100,
    });
  });

  it("throws instead of returning a truncated list beyond 10 pages", async () => {
    sdk.payments.all.mockResolvedValue(page(0, 100));
    await expect(fetchRazorpayPaymentsCreatedBetween(from, to)).rejects.toThrow(
      "Too many payments"
    );
    expect(sdk.payments.all).toHaveBeenCalledTimes(10);
  });
});

describe("read-only", () => {
  it("never calls a Razorpay write method", async () => {
    sdk.payments.fetch.mockResolvedValue(sdkPayment());
    sdk.orders.fetchPayments.mockResolvedValue({
      entity: "collection",
      count: 0,
      items: [],
    });
    sdk.payments.fetchMultipleRefund.mockResolvedValue({
      entity: "collection",
      count: 0,
      items: [],
    });
    sdk.payments.all.mockResolvedValue({ entity: "collection", count: 0, items: [] });
    await fetchRazorpayPayment("pay_x");
    await fetchRazorpayOrderPayments("order_x");
    await fetchRazorpayPaymentRefunds("pay_x");
    await fetchRazorpayPaymentsCreatedBetween(new Date(0), new Date());
    expect(sdk.orders.create).not.toHaveBeenCalled();
    expect(sdk.payments.capture).not.toHaveBeenCalled();
    expect(sdk.payments.refund).not.toHaveBeenCalled();
    expect(sdk.refunds.edit).not.toHaveBeenCalled();
  });
});
