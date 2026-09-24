import { describe, it, expect } from "vitest";
import { razorpayEventKey } from "@/server/services/razorpay.service";

describe("razorpayEventKey", () => {
  const body = JSON.stringify({
    event: "payment.captured",
    payload: { payment: { entity: { id: "pay_1" } } },
  });

  it("uses Razorpay's x-razorpay-event-id when present", () => {
    expect(razorpayEventKey("evt_ABC123", body)).toBe("evt:evt_ABC123");
  });

  it("is identical for a redelivery with the same event id, whatever the body", () => {
    expect(razorpayEventKey("evt_ABC123", body)).toBe(
      razorpayEventKey("evt_ABC123", body + " ")
    );
  });

  it("does not collapse distinct event ids", () => {
    expect(razorpayEventKey("evt_1", body)).not.toBe(razorpayEventKey("evt_2", body));
  });

  it("falls back to a stable hash of the raw body when the header is absent", () => {
    const key = razorpayEventKey(null, body);
    expect(key).toMatch(/^body:[0-9a-f]{64}$/);
    expect(razorpayEventKey(undefined, body)).toBe(key);
    expect(razorpayEventKey("", body)).toBe(key);
  });

  it("gives different bodies different fallback keys", () => {
    expect(razorpayEventKey(null, body)).not.toBe(
      razorpayEventKey(null, body.replace("pay_1", "pay_2"))
    );
  });

  it("ignores a malformed (unsigned) header value and uses the body hash", () => {
    expect(razorpayEventKey("evt 1; drop", body)).toBe(razorpayEventKey(null, body));
    expect(razorpayEventKey("x".repeat(101), body)).toBe(razorpayEventKey(null, body));
  });

  it("is never time-based", async () => {
    const first = razorpayEventKey(null, body);
    await new Promise((r) => setTimeout(r, 5));
    expect(razorpayEventKey(null, body)).toBe(first);
  });
});
