import { db } from "@/server/db";
import { nanoid } from "nanoid";
import { CERTIFICATE_PRICE_INR } from "@/lib/constants";
import {
  createRazorpayOrder,
  razorpayEventKey,
  verifyRazorpaySignature,
} from "./razorpay.service";
import { Prisma } from "@prisma/client";
import { isTrustedResult } from "@/lib/certificateEligibility";
import { fulfillCertificate, revokeCertificateTx } from "./certificate.service";
import { logger } from "@/lib/logger";
import { ServiceError, isUniqueViolation } from "@/server/errors";

type OrderInfo = { orderId: string; amount: number; currency: string };

const toOrder = (p: {
  orderId: string;
  amount: number;
  currency: string;
}): OrderInfo => ({
  orderId: p.orderId,
  amount: p.amount,
  currency: p.currency,
});

/**
 * Returns the Razorpay order to pay for a certificate. One Payment row per
 * certificate (unique certificateId):
 *
 * - PENDING   → reuse its order (idempotent; no new Razorpay order).
 * - FAILED    → flip the same row back to PENDING and reuse the SAME order.
 *               Razorpay keeps an order "attempted" and accepting new attempts
 *               until one payment is captured, and binds one successful
 *               payment per order, so the webhook's orderId mapping never
 *               changes and a second charge is impossible.
 * - COMPLETED/REFUNDED → already paid; never start another order.
 * - none      → create the Razorpay order, then the row. A concurrent first
 *               request that loses the unique race reuses the winner's order.
 */
export async function createCertificateOrder(
  certificateId: string,
  userId: string
): Promise<OrderInfo> {
  const cert = await db.certificate.findUnique({ where: { certificateId } });
  if (!cert) throw new ServiceError("Certificate not found", "NOT_FOUND", 404);
  if (cert.userId !== userId) throw new ServiceError("Unauthorized", "FORBIDDEN", 403);
  if (cert.status !== "PENDING_PAYMENT") {
    throw new ServiceError(
      `Cannot create order for certificate in ${cert.status} state`,
      "INVALID_STATE",
      409
    );
  }

  const existing = await db.payment.findUnique({ where: { certificateId: cert.id } });

  if (existing?.status === "PENDING") return toOrder(existing);

  if (existing?.status === "FAILED") {
    // Atomic: only a still-FAILED row is reopened; a concurrent retry that
    // already reopened it just leaves it PENDING on the same order.
    await db.payment.updateMany({
      where: { id: existing.id, status: "FAILED" },
      data: { status: "PENDING", paymentId: null },
    });
    return currentPendingOrder(cert.id);
  }

  if (existing) {
    throw new ServiceError("Certificate has already been paid", "ALREADY_PAID", 409);
  }

  const rzpOrder = await createRazorpayOrder(
    CERTIFICATE_PRICE_INR,
    `cert_${cert.certificateId}`
  );

  try {
    const payment = await db.payment.create({
      data: {
        userId,
        certificateId: cert.id,
        orderId: rzpOrder.orderId,
        amount: CERTIFICATE_PRICE_INR,
        currency: rzpOrder.currency,
        idempotencyKey: nanoid(),
        status: "PENDING",
      },
    });
    return toOrder(payment);
  } catch (error) {
    // A concurrent first request created the row; its order wins and ours is
    // left unpaid.
    if (isUniqueViolation(error, "certificateId")) return currentPendingOrder(cert.id);
    throw error;
  }
}

async function currentPendingOrder(certificateInternalId: string): Promise<OrderInfo> {
  const payment = await db.payment.findUnique({
    where: { certificateId: certificateInternalId },
  });
  if (payment?.status !== "PENDING") {
    throw new ServiceError(
      "Payment state changed, please try again",
      "PAYMENT_STATE_CHANGED",
      409
    );
  }
  return toOrder(payment);
}

/**
 * Payment state machine (certificate purchases):
 *
 *   PENDING ──payment.captured──▶ COMPLETED ──refund.processed (full)──▶ REFUNDED
 *      │                              ▲
 *      └──payment.failed──▶ FAILED ───┘ (a retried attempt on the same order
 *                                        can still be captured)
 *
 * `payment.authorized` is recorded but changes nothing: an authorized payment
 * is not settled (Razorpay auto-refunds uncaptured payments), so the paid
 * certificate is only fulfilled once the payment is captured.
 * `refund.created` / `refund.failed` and partial refunds are recorded only.
 *
 * Capture → fulfillment:
 *   1. verify signature  2. idempotency (one PaymentEvent per provider event)
 *   3. amount/currency check  4. in one transaction: payment COMPLETED and
 *   certificate PENDING_PAYMENT → PENDING_FULFILLMENT  5. commit
 *   6. outside the transaction: generate + store PDF/QR, then ACTIVE
 *   (fulfillCertificate). A fulfillment failure leaves the payment committed
 *   and the certificate PENDING_FULFILLMENT, to be retried by a redelivered
 *   capture event or by the owner (retryCertificateFulfillment).
 *
 * Idempotency: the unique providerEventId (razorpayEventKey) serialises
 * duplicate deliveries; a concurrent duplicate that loses the race is treated
 * as already processed. Every state change is a compare-and-set, so events for
 * the same order that race (capture vs refund) cannot overwrite each other.
 */
export async function processRazorpayWebhook(
  payload: Record<string, unknown>,
  signature: string,
  payloadRawString: string,
  eventIdHeader?: string | null
) {
  if (!verifyRazorpaySignature(payloadRawString, signature)) {
    throw new Error("INVALID_PAYMENT_SIGNATURE");
  }

  const eventType = payload.event as string;
  const eventPayload = payload.payload as Record<string, unknown> | undefined;
  const entityOf = (key: string) =>
    (eventPayload?.[key] as { entity?: Record<string, unknown> } | undefined)?.entity;
  const eventId = razorpayEventKey(eventIdHeader, payloadRawString);

  try {
    await applyPaymentEvent(
      eventId,
      eventType,
      entityOf("payment"),
      entityOf("refund"),
      payload
    );
  } catch (error) {
    // A concurrent delivery of the same event committed first; it is handled.
    if (!isUniqueViolation(error, "providerEventId")) throw error;
  }

  // After commit — and on every redelivery of the capture, including the
  // duplicates skipped above — complete fulfillment of a paid certificate.
  // "Financially processed" (the PaymentEvent, never repeated) is separate
  // from "fulfilled" (status ACTIVE). A fulfillment failure is rethrown
  // (FULFILLMENT_FAILED, 503) so Razorpay redelivers this event: the capture
  // is not applied again, and fulfillment is retried until it succeeds.
  if (eventType === "payment.captured") {
    const orderId = entityOf("payment")?.order_id;
    if (typeof orderId === "string") await fulfillPaidCertificate(orderId);
  }
}

async function fulfillPaidCertificate(orderId: string) {
  const payment = await db.payment.findUnique({
    where: { orderId },
    select: {
      status: true,
      certificate: { select: { certificateId: true, status: true } },
    },
  });
  if (
    payment?.status !== "COMPLETED" ||
    payment.certificate?.status !== "PENDING_FULFILLMENT"
  ) {
    return;
  }
  // Throws on failure (logged by fulfillCertificate); the certificate stays
  // PENDING_FULFILLMENT with its identity unchanged.
  await fulfillCertificate(payment.certificate.certificateId);
}

function isFullRefund(
  paymentEntity: Record<string, unknown> | undefined,
  refundEntity: Record<string, unknown> | undefined,
  amount: number
): boolean {
  if (paymentEntity?.refund_status === "full") return true;
  const refunded = Number(paymentEntity?.amount_refunded ?? refundEntity?.amount ?? 0);
  return refunded >= amount;
}

async function applyPaymentEvent(
  eventId: string,
  eventType: string,
  entity: Record<string, unknown> | undefined,
  refundEntity: Record<string, unknown> | undefined,
  payload: Record<string, unknown>
) {
  await db.$transaction(async (tx) => {
    // 1. Idempotency Check
    const existingEvent = await tx.paymentEvent.findUnique({
      where: { providerEventId: eventId },
    });

    if (existingEvent) {
      // Safely ignore duplicate events
      return;
    }

    // Refund payloads carry the payment entity too; fall back to the refund's
    // payment_id if it is ever missing.
    const orderId = entity?.order_id;
    const refundPaymentId = refundEntity?.payment_id;
    const payment =
      typeof orderId === "string"
        ? await tx.payment.findUnique({ where: { orderId } })
        : typeof refundPaymentId === "string"
          ? await tx.payment.findFirst({ where: { paymentId: refundPaymentId } })
          : null;

    if (!payment) {
      // Order not found, might not be ours
      return;
    }

    const paymentId = entity?.id as string | undefined;

    // 2. Create Event
    await tx.paymentEvent.create({
      data: {
        paymentId: payment.id,
        provider: "RAZORPAY",
        providerEventId: eventId,
        eventType,
        payload: payload as Prisma.InputJsonValue,
        processedAt: new Date(),
      },
    });

    // 3. Process Event Type
    if (eventType === "payment.captured") {
      // Already settled (COMPLETED/REFUNDED): never touched by a capture again.
      if (payment.status === "COMPLETED" || payment.status === "REFUNDED") return;
      if (!entity || entity.status !== "captured") return;

      if (entity.amount !== payment.amount || entity.currency !== payment.currency) {
        throw new Error("PAYMENT_AMOUNT_MISMATCH");
      }

      // A retry on the same order can capture after an earlier attempt FAILED.
      // Compare-and-set: a refund committed concurrently is not overwritten.
      const { count } = await tx.payment.updateMany({
        where: { id: payment.id, status: { in: ["PENDING", "FAILED"] } },
        data: { status: "COMPLETED", paymentId: paymentId ?? null },
      });
      if (count === 1 && payment.certificateId) {
        await markCertificatePaid(payment.certificateId, tx);
      }
    } else if (eventType === "payment.failed") {
      await tx.payment.updateMany({
        where: { id: payment.id, status: "PENDING" },
        data: { status: "FAILED", paymentId: paymentId ?? null },
      });
    } else if (eventType === "refund.processed") {
      // Only a processed (completed) refund counts; refund.created is only a
      // request and refund.failed means nothing was returned.
      if (refundEntity?.status !== undefined && refundEntity.status !== "processed") {
        return;
      }
      if (!isFullRefund(entity, refundEntity, payment.amount)) {
        logger.warn("Partial certificate refund processed; certificate left unchanged", {
          paymentId: payment.id,
        });
        return;
      }

      // Razorpay auto-refunds uncaptured authorizations: nothing was paid, so
      // the purchase stays open for another attempt on the same order.
      if (payment.status !== "COMPLETED" && entity?.captured === false) return;

      // Otherwise from any state: a refund delivered before its capture event
      // must still prevent the late capture from activating the certificate.
      await tx.payment.updateMany({
        where: { id: payment.id, status: { not: "REFUNDED" } },
        data: { status: "REFUNDED" },
      });
      if (payment.certificateId) {
        await revokeCertificateTx(
          tx,
          { id: payment.certificateId },
          "REFUND: payment refunded"
        );
      }
    }
  });
}

/** Payment captured: PENDING_PAYMENT → PENDING_FULFILLMENT (same transaction). */
async function markCertificatePaid(
  certificateInternalId: string,
  tx: Prisma.TransactionClient
) {
  const cert = await tx.certificate.findUnique({
    where: { id: certificateInternalId },
    include: { result: true },
  });
  if (!cert || cert.status !== "PENDING_PAYMENT") return;

  // Same trust rule as certificate issuance. A result that lost its trusted
  // status after checkout is held for manual review (and refund), not issued.
  if (!cert.result || !isTrustedResult(cert.result)) {
    logger.error(
      "Paid certificate's result is no longer trusted; held for review",
      undefined,
      {
        certificateId: cert.certificateId,
      }
    );
    return;
  }

  await tx.certificate.updateMany({
    where: { id: cert.id, status: "PENDING_PAYMENT" },
    data: { status: "PENDING_FULFILLMENT" },
  });
}
