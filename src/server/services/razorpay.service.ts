import Razorpay from "razorpay";
import { getServerEnv } from "@/lib/env";
import { createHmac } from "crypto";

let razorpayClient: Razorpay | undefined;

function getRazorpayClient() {
  if (!razorpayClient) {
    const env = getServerEnv();
    razorpayClient = new Razorpay({
      key_id: env.RAZORPAY_KEY_ID,
      key_secret: env.RAZORPAY_KEY_SECRET,
    });
  }
  return razorpayClient;
}

export async function createRazorpayOrder(amountPaise: number, receiptId: string, notes: Record<string, string> = {}) {
  const rzp = getRazorpayClient();
  const options = {
    amount: amountPaise,
    currency: "INR",
    receipt: receiptId,
    notes,
  };
  
  const order = await rzp.orders.create(options);
  return {
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    receipt: order.receipt
  };
}

export function verifyRazorpaySignature(payloadStr: string, signature: string): boolean {
  const env = getServerEnv();
  const secret = env.RAZORPAY_WEBHOOK_SECRET;
  
  const expectedSignature = createHmac("sha256", secret)
    .update(payloadStr)
    .digest("hex");
    
  return expectedSignature === signature;
}
