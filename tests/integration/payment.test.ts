import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { db } from "@/server/db";
import {
  createCertificateOrder,
  processRazorpayWebhook,
} from "@/server/services/payment.service";
import * as RazorpayService from "@/server/services/razorpay.service";
import { CERTIFICATE_PRICE_INR } from "@/lib/constants";
import { nanoid } from "nanoid";

vi.mock("@/server/services/razorpay.service", async (importOriginal) => ({
  createRazorpayOrder: vi.fn(),
  verifyRazorpaySignature: vi.fn(),
  // Real, pure event-key derivation.
  razorpayEventKey: (
    (await importOriginal()) as typeof import("@/server/services/razorpay.service")
  ).razorpayEventKey,
}));

vi.mock("@/server/db", () => {
  const db = {
    $transaction: vi.fn(async (cb) => cb(db)),
    certificate: {
      findUniqueOrThrow: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    payment: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    paymentEvent: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  };
  return { db };
});

describe("Payment Service", () => {
  let cert: any;

  beforeEach(() => {
    vi.clearAllMocks();

    cert = {
      id: "cert1",
      certificateId: "TF-2026-XQ4P2Z",
      userId: "u1",
      status: "PENDING_PAYMENT",
      pdfUrl: "https://mock.storage/path.pdf",
      result: {
        integrityStatus: "VERIFIED",
        scoringSource: "SERVER_RECONSTRUCTED",
      },
    };
  });

  describe("createCertificateOrder", () => {
    it("should create order successfully for eligible cert", async () => {
      (db.certificate.findUnique as any).mockResolvedValue(cert);
      (db.payment.findUnique as any).mockResolvedValue(null);

      const mockOrder = {
        orderId: "order_123",
        amount: CERTIFICATE_PRICE_INR,
        currency: "INR",
      };
      (RazorpayService.createRazorpayOrder as any).mockResolvedValue(mockOrder);

      (db.payment.create as any).mockResolvedValue({
        id: "pay_1",
        orderId: "order_123",
        amount: CERTIFICATE_PRICE_INR,
        currency: "INR",
        status: "PENDING",
      });

      const order = await createCertificateOrder(cert.certificateId, "u1");

      expect(order.orderId).toBe("order_123");
      expect(order.amount).toBe(CERTIFICATE_PRICE_INR);
    });

    it("should return existing order if PENDING payment exists (idempotency)", async () => {
      (db.certificate.findUnique as any).mockResolvedValue(cert);

      (db.payment.findUnique as any).mockResolvedValue({
        status: "PENDING",
        orderId: "order_existing",
        amount: CERTIFICATE_PRICE_INR,
        currency: "INR",
      });

      const order = await createCertificateOrder(cert.certificateId, "u1");

      expect(order.orderId).toBe("order_existing");
      expect(RazorpayService.createRazorpayOrder).not.toHaveBeenCalled();
    });

    it("should throw if not authorized", async () => {
      (db.certificate.findUnique as any).mockResolvedValue(cert);
      await expect(createCertificateOrder(cert.certificateId, "u2")).rejects.toThrow(
        "Unauthorized"
      );
    });

    it("should throw if certificate not PENDING_PAYMENT", async () => {
      cert.status = "ACTIVE";
      (db.certificate.findUnique as any).mockResolvedValue(cert);
      await expect(createCertificateOrder(cert.certificateId, "u1")).rejects.toThrow(
        "Cannot create order"
      );
    });
  });

  describe("processRazorpayWebhook", () => {
    let payload: any;

    beforeEach(() => {
      payload = {
        event: "payment.captured",
        account_id: "acc_1",
        payload: {
          payment: {
            entity: {
              id: "pay_123",
              order_id: "order_123",
              amount: CERTIFICATE_PRICE_INR,
              currency: "INR",
              status: "captured",
            },
          },
        },
      };

      (RazorpayService.verifyRazorpaySignature as any).mockReturnValue(true);
      (db.paymentEvent.findUnique as any).mockResolvedValue(null);
      (db.payment.findUnique as any).mockResolvedValue({
        id: "p1",
        orderId: "order_123",
        amount: CERTIFICATE_PRICE_INR,
        currency: "INR",
        status: "PENDING",
        certificateId: "cert1",
      });
      (db.certificate.findUnique as any).mockResolvedValue(cert);
      (db.payment.updateMany as any).mockResolvedValue({ count: 1 });
      (db.certificate.updateMany as any).mockResolvedValue({ count: 1 });
    });

    it("should complete payment.captured and queue the cert for fulfillment", async () => {
      await processRazorpayWebhook(payload, "sig", "raw");

      expect(db.paymentEvent.create).toHaveBeenCalled();
      expect(db.payment.updateMany).toHaveBeenCalledWith({
        where: { id: "p1", status: { in: ["PENDING", "FAILED"] } },
        data: { status: "COMPLETED", paymentId: "pay_123" },
      });
      // Activation happens only after the PDF is stored (fulfillCertificate),
      // outside this transaction; covered against Postgres in
      // certificate-fulfillment-pg.test.ts.
      expect(db.certificate.updateMany).toHaveBeenCalledWith({
        where: { id: "cert1", status: "PENDING_PAYMENT" },
        data: { status: "PENDING_FULFILLMENT" },
      });
      expect(db.certificate.update).not.toHaveBeenCalled();
    });

    it("should ignore if signature invalid", async () => {
      (RazorpayService.verifyRazorpaySignature as any).mockReturnValue(false);
      await expect(processRazorpayWebhook(payload, "bad_sig", "raw")).rejects.toThrow(
        "INVALID_PAYMENT_SIGNATURE"
      );
    });

    it("should ignore duplicate events (idempotency)", async () => {
      (db.paymentEvent.findUnique as any).mockResolvedValue({ id: "evt_1" });
      await processRazorpayWebhook(payload, "sig", "raw");
      expect(db.payment.updateMany).not.toHaveBeenCalled();
      expect(db.certificate.updateMany).not.toHaveBeenCalled();
    });

    it("should throw if amount mismatches", async () => {
      payload.payload.payment.entity.amount = 100; // mismatch
      await expect(processRazorpayWebhook(payload, "sig", "raw")).rejects.toThrow(
        "PAYMENT_AMOUNT_MISMATCH"
      );
    });

    it("should update payment to FAILED on payment.failed", async () => {
      payload.event = "payment.failed";
      await processRazorpayWebhook(payload, "sig", "raw");
      expect(db.payment.updateMany).toHaveBeenCalledWith({
        where: { id: "p1", status: "PENDING" },
        data: { status: "FAILED", paymentId: "pay_123" },
      });
      expect(db.certificate.updateMany).not.toHaveBeenCalled();
    });

    it("revokes the certificate on a processed full refund", async () => {
      payload.event = "refund.processed";
      payload.payload.payment.entity.refund_status = "full";
      payload.payload.payment.entity.amount_refunded = CERTIFICATE_PRICE_INR;
      payload.payload.refund = {
        entity: { id: "rfnd_1", payment_id: "pay_123", status: "processed" },
      };
      (db.payment.findUnique as any).mockResolvedValue({
        id: "p1",
        status: "COMPLETED",
        amount: CERTIFICATE_PRICE_INR,
        currency: "INR",
        certificateId: "cert1",
      });
      await processRazorpayWebhook(payload, "sig", "raw");
      expect(db.payment.updateMany).toHaveBeenCalledWith({
        where: { id: "p1", status: { not: "REFUNDED" } },
        data: { status: "REFUNDED" },
      });
      expect(db.certificate.updateMany).toHaveBeenCalledWith({
        where: { id: "cert1", status: { not: "REVOKED" } },
        data: expect.objectContaining({ status: "REVOKED" }),
      });
    });

    it("records refund.created without refunding or revoking", async () => {
      payload.event = "refund.created";
      await processRazorpayWebhook(payload, "sig", "raw");
      expect(db.paymentEvent.create).toHaveBeenCalled();
      expect(db.payment.updateMany).not.toHaveBeenCalled();
      expect(db.certificate.updateMany).not.toHaveBeenCalled();
    });
  });
});
