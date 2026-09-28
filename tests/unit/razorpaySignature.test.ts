import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import { verifyRazorpaySignature } from "@/server/services/razorpay.service";
import { verifyRazorpaySubscriptionSignature } from "@/server/services/razorpay.subscription.service";

// tests/setup/test-env.ts provides RAZORPAY_WEBHOOK_SECRET.
const sign = (body: string, secret = process.env.RAZORPAY_WEBHOOK_SECRET as string) =>
  createHmac("sha256", secret).update(body).digest("hex");

describe.each([
  ["verifyRazorpaySignature", verifyRazorpaySignature],
  ["verifyRazorpaySubscriptionSignature", verifyRazorpaySubscriptionSignature],
] as const)("%s", (_name, verify) => {
  const body = JSON.stringify({ event: "payment.captured", payload: {} });
  const good = sign(body);

  it("accepts the exact HMAC-SHA256 hex digest of the raw body", () => {
    expect(verify(body, good)).toBe(true);
  });

  it("rejects another body or another secret", () => {
    expect(verify(`${body} `, good)).toBe(false);
    expect(verify(body, sign(body, "another-secret"))).toBe(false);
  });

  it.each([
    ["empty", ""],
    ["short", good.slice(0, 63)],
    ["long", `${good}0`],
    ["twice as long", good + good],
    ["uppercase", good.toUpperCase()],
    ["non-hex", "g".repeat(64)],
    ["with whitespace", ` ${good.slice(1)}`],
  ])("rejects a %s signature without throwing", (_kind, signature) => {
    expect(() => verify(body, signature)).not.toThrow();
    expect(verify(body, signature)).toBe(false);
  });
});
