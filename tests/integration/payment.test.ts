import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { db } from "@/server/db";
import {
  createCertificateOrder,
  processRazorpayWebhook,
} from "@/server/services/payment.service";
import * as RazorpayService from "@/server/services/razorpay.service";
import { CERTIFICATE_PRICE_INR } from "@/lib/constants";
import { nanoid } from "nanoid";

vi.mock("@/server/services/razorpay.service", () => ({
  createRazorpayOrder: vi.fn(),
  verifyRazorpaySignature: vi.fn(),
}));

vi.mock("@/server/db", () => {
  const db = {
    $transaction: vi.fn(async (cb) => cb(db)),
    certificate: {
      findUniqueOrThrow: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    payment: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
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
      },
    };
  });

  describe("createCertificateOrder", () => {
    it("should create order successfully for eligible cert", async () => {
      (db.certificate.findUniqueOrThrow as any).mockResolvedValue(cert);
      (db.payment.findFirst as any).mockResolvedValue(null);

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
      (db.certificate.findUniqueOrThrow as any).mockResolvedValue(cert);

      (db.payment.findFirst as any).mockResolvedValue({
        orderId: "order_existing",
        amount: CERTIFICATE_PRICE_INR,
        currency: "INR",
      });

      const order = await createCertificateOrder(cert.certificateId, "u1");

      expect(order.orderId).toBe("order_existing");
      expect(RazorpayService.createRazorpayOrder).not.toHaveBeenCalled();
    });

    it("should throw if not authorized", async () => {
      (db.certificate.findUniqueOrThrow as any).mockResolvedValue(cert);
      await expect(createCertificateOrder(cert.certificateId, "u2")).rejects.toThrow(
        "Unauthorized"
      );
    });

    it("should throw if certificate not PENDING_PAYMENT", async () => {
      cert.status = "ACTIVE";
      (db.certificate.findUniqueOrThrow as any).mockResolvedValue(cert);
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
    });

    it("should process payment.captured successfully and activate cert", async () => {
      await processRazorpayWebhook(payload, "sig", "raw");

      expect(db.paymentEvent.create).toHaveBeenCalled();
      expect(db.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "COMPLETED", paymentId: "pay_123" }),
        })
      );
      expect(db.certificate.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: "ACTIVE" },
        })
      );
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
      expect(db.payment.update).not.toHaveBeenCalled();
    });

    it("should throw if amount mismatches", async () => {
      payload.payload.payment.entity.amount = 100; // mismatch
      await expect(processRazorpayWebhook(payload, "sig", "raw")).rejects.toThrow(
        "PAYMENT_AMOUNT_MISMATCH"
      );
    });

    it("should not activate cert if PDF storage failed (fallback url)", async () => {
      cert.pdfUrl = `https://storage.typeflow.app/certificates/${cert.certificateId}.pdf`;
      (db.certificate.findUnique as any).mockResolvedValue(cert);

      await processRazorpayWebhook(payload, "sig", "raw");

      // Payment is completed
      expect(db.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "COMPLETED" }),
        })
      );
      // Cert is NOT activated
      expect(db.certificate.update).not.toHaveBeenCalled();
    });

    it("should update payment to FAILED on payment.failed", async () => {
      payload.event = "payment.failed";
      await processRazorpayWebhook(payload, "sig", "raw");
      expect(db.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "FAILED" }),
        })
      );
      expect(db.certificate.update).not.toHaveBeenCalled();
    });

    it("should handle refund event without revoking cert", async () => {
      payload.event = "refund.processed";
      (db.payment.findUnique as any).mockResolvedValue({
        id: "p1",
        status: "COMPLETED",
        amount: CERTIFICATE_PRICE_INR,
        currency: "INR",
      });
      await processRazorpayWebhook(payload, "sig", "raw");
      expect(db.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "REFUNDED" }),
        })
      );
      expect(db.certificate.update).not.toHaveBeenCalled(); // as per explicitly documented behavior
    });
  });

  describe("retryCertificateActivation", () => {
    it("should activate if payment is COMPLETED and storage exists", async () => {
      (db.payment.findUnique as any).mockResolvedValue({
        id: "p1",
        status: "COMPLETED",
        certificateId: "cert1",
      });
      (db.certificate.findUnique as any)
        .mockResolvedValueOnce(cert) // Inside activateCertificate
        .mockResolvedValueOnce({ ...cert, status: "ACTIVE" }); // After update

      const { retryCertificateActivation } = await import(
        "@/server/services/payment.service"
      );
      await retryCertificateActivation("p1");

      expect(db.certificate.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "cert1" },
          data: { status: "ACTIVE" },
        })
      );
    });

    it("should throw if payment is not COMPLETED", async () => {
      (db.payment.findUnique as any).mockResolvedValue({
        id: "p1",
        status: "PENDING",
        certificateId: "cert1",
      });
      const { retryCertificateActivation } = await import(
        "@/server/services/payment.service"
      );
      await expect(retryCertificateActivation("p1")).rejects.toThrow("Invalid payment");
    });

    it("should throw if PDF storage failed (fallback URL)", async () => {
      (db.payment.findUnique as any).mockResolvedValue({
        id: "p1",
        status: "COMPLETED",
        certificateId: "cert1",
      });

      const badCert = {
        ...cert,
        pdfUrl: `https://storage.typeflow.app/certificates/${cert.certificateId}.pdf`,
      };
      (db.certificate.findUnique as any).mockResolvedValue(badCert);

      const { retryCertificateActivation } = await import(
        "@/server/services/payment.service"
      );
      await expect(retryCertificateActivation("p1")).rejects.toThrow(
        "Activation failed: PDF storage unavailable"
      );
    });
  });
});
