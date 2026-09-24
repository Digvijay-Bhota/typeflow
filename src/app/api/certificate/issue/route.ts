import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/server/services/auth.service";
import { createCertificate } from "@/server/services/certificate.service";

import { rateLimit } from "@/server/middleware/rateLimit";
import { isServiceError } from "@/server/errors";
import { z } from "zod";

const IssueCertificateSchema = z.object({ resultId: z.string().uuid() });

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";
    const { success } = await rateLimit(`cert_issue_${ip}`, 10, 60000);
    if (!success) {
      return NextResponse.json(
        { error: { code: "RATE_LIMITED", message: "Too many requests" } },
        { status: 429 }
      );
    }

    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
        { status: 401 }
      );
    }

    const parsed = IssueCertificateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "A valid resultId is required" } },
        { status: 400 }
      );
    }

    // Eligibility and ownership are re-checked server-side; the client's
    // isCertificateEligible flag is never trusted.
    const cert = await createCertificate(user.id, parsed.data.resultId);

    return NextResponse.json({
      certificateId: cert.certificateId,
    });
  } catch (error: unknown) {
    if (isServiceError(error)) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status }
      );
    }

    // Unexpected failure: never expose database/provider details.
    console.error("Issue certificate error:", error);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Failed to issue certificate" } },
      { status: 500 }
    );
  }
}
