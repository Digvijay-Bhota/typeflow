import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/server/services/auth.service";
import { createCertificate } from "@/server/services/certificate.service";

import { rateLimit } from "@/server/middleware/rateLimit";

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";
    const { success } = await rateLimit(`cert_issue_${ip}`, 10, 60000);
    if (!success) {
      return NextResponse.json({ error: { code: "RATE_LIMITED", message: "Too many requests" } }, { status: 429 });
    }

    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { resultId } = body;

    if (!resultId) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Missing resultId" } },
        { status: 400 }
      );
    }

    const cert = await createCertificate(user.id, resultId);
    
    return NextResponse.json({
      certificateId: cert.certificateId
    });

  } catch (error: unknown) {
    console.error("Issue certificate error:", error);
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: (error as Error).message || "Failed to issue certificate" } },
      { status: 400 }
    );
  }
}
