import { db } from "@/server/db";
import { nanoid } from "nanoid";
import { CERTIFICATE_PRICE_INR } from "@/lib/constants";
import { createRazorpayOrder, verifyRazorpaySignature } from "./razorpay.service";
import { Prisma } from "@prisma/client";

export async function createCertificateOrder(certificateId: string, userId: string) {
  return await db.$transaction(async (tx) => {
    const cert = await tx.certificate.findUniqueOrThrow({
      where: { certificateId }
    });

    if (cert.userId !== userId) {
      throw new Error("Unauthorized");
    }

    if (cert.status !== "PENDING_PAYMENT") {
      throw new Error(`Cannot create order for certificate in ${cert.status} state`);
    }

    // Ensure idempotency for creating orders by checking existing PENDING payment
    const existingPayment = await tx.payment.findFirst({
      where: { certificateId: cert.id, status: "PENDING" }
    });

    if (existingPayment) {
      return {
        orderId: existingPayment.orderId,
        amount: existingPayment.amount,
        currency: existingPayment.currency,
      };
    }

    const idempotencyKey = nanoid();
    const amount = CERTIFICATE_PRICE_INR;
    
    const rzpOrder = await createRazorpayOrder(amount, `cert_${cert.certificateId}`);

    const payment = await tx.payment.create({
      data: {
        userId,
        certificateId: cert.id,
        orderId: rzpOrder.orderId,
        amount,
        currency: rzpOrder.currency,
        idempotencyKey,
        status: "PENDING",
      }
    });

    return {
      orderId: payment.orderId,
      amount: payment.amount,
      currency: payment.currency,
    };
  });
}

export async function processRazorpayWebhook(payload: Record<string, unknown>, signature: string, payloadRawString: string) {
  if (!verifyRazorpaySignature(payloadRawString, signature)) {
    throw new Error("INVALID_PAYMENT_SIGNATURE");
  }

  const eventType = payload.event as string;
  const paymentPayload = payload.payload as Record<string, unknown>;
  const paymentEntity = paymentPayload?.payment as Record<string, unknown> | undefined;
  const entity = paymentEntity?.entity as Record<string, unknown> | undefined;
  const eventId = String(payload.account_id) + "_" + eventType + "_" + (entity?.id || nanoid());

  // Use a transaction for idempotency and atomicity
  await db.$transaction(async (tx) => {
    // 1. Idempotency Check
    const existingEvent = await tx.paymentEvent.findUnique({
      where: { providerEventId: eventId }
    });

    if (existingEvent) {
      // Safely ignore duplicate events
      return;
    }

    if (!entity) return;

    const orderId = entity.order_id as string;
    const paymentId = entity.id as string;
    
    const payment = await tx.payment.findUnique({
      where: { orderId }
    });

    if (!payment) {
      // Order not found, might not be ours
      return;
    }

    // 2. Create Event
    await tx.paymentEvent.create({
      data: {
        paymentId: payment.id,
        provider: "RAZORPAY",
        providerEventId: eventId,
        eventType,
        payload: payload as Prisma.InputJsonValue,
        processedAt: new Date()
      }
    });

    // 3. Process Event Type
    if (eventType === "payment.captured" || eventType === "payment.authorized") {
      if (payment.status === "COMPLETED") return;

      if (entity.amount !== payment.amount || entity.currency !== payment.currency) {
        throw new Error("PAYMENT_AMOUNT_MISMATCH");
      }

      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: "COMPLETED",
          paymentId
        }
      });

      if (payment.certificateId) {
        await activateCertificate(payment.certificateId, tx);
      }
    } else if (eventType === "payment.failed") {
      if (payment.status === "PENDING") {
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: "FAILED", paymentId }
        });
      }
    } else if (eventType === "refund.created" || eventType === "refund.processed") {
      if (payment.status === "COMPLETED") {
        await tx.payment.update({
          where: { id: payment.id },
          data: { status: "REFUNDED" }
        });
        
        // As explicitly documented, refunds do NOT automatically revoke certificates 
        // to prevent gaming the system. Refund revocation requires manual admin review.
      }
    }
  });
}

async function activateCertificate(certificateInternalId: string, tx: Prisma.TransactionClient) {
  const cert = await tx.certificate.findUnique({
    where: { id: certificateInternalId },
    include: { result: true }
  });

  if (!cert) return;

  if (cert.status !== "PENDING_PAYMENT") return;

  if (cert.result?.integrityStatus !== "VERIFIED") return;

  // Requirement: PDF storage must be verified before activating.
  // The fallback URL relies on our own domain, while Supabase URL usually doesn't,
  // or Supabase URL is constructed if storage credentials were unavailable.
  // A robust check is ensuring pdfUrl exists and is not the fallback.
  // Wait, the fallback is exactly "https://storage.typeflow.app/..."
  if (!cert.pdfUrl || cert.pdfUrl === `https://storage.typeflow.app/certificates/${cert.certificateId}.pdf`) {
    // PDF storage unavailable or failed. Do not transition to ACTIVE.
    return;
  }

  await tx.certificate.update({
    where: { id: cert.id },
    data: { status: "ACTIVE" }
  });
}

export async function retryCertificateActivation(paymentInternalId: string) {
  await db.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({
      where: { id: paymentInternalId }
    });

    if (!payment || payment.status !== "COMPLETED" || !payment.certificateId) {
      throw new Error("Invalid payment for activation retry");
    }

    await activateCertificate(payment.certificateId, tx);
    
    // Check if it got activated
    const cert = await tx.certificate.findUnique({
      where: { id: payment.certificateId }
    });
    
    if (cert?.status !== "ACTIVE") {
      throw new Error("Activation failed: PDF storage unavailable or certificate ineligible");
    }
  });
}
