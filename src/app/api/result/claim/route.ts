import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { requireAuthenticatedUser } from "@/server/services/auth.service";
import { rateLimit } from "@/server/middleware/rateLimit";
import crypto from "crypto";

export async function POST(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";
    const { success, remaining, limit, reset } = await rateLimit(
      `claim_result_${ip}`,
      5,
      60000
    );

    if (!success) {
      return NextResponse.json(
        {
          error: {
            requestId: crypto.randomUUID(),
            code: "RATE_LIMITED",
            message: "Too many requests.",
          },
        },
        {
          status: 429,
          headers: {
            "X-RateLimit-Limit": limit.toString(),
            "X-RateLimit-Remaining": remaining.toString(),
            "X-RateLimit-Reset": reset.toString(),
          },
        }
      );
    }

    const user = await requireAuthenticatedUser();
    const { claimToken } = await req.json();

    if (!claimToken || typeof claimToken !== "string") {
      return NextResponse.json(
        { error: { message: "Invalid claim token" } },
        { status: 400 }
      );
    }

    // Find result by claim token
    const result = await db.testResult.findUnique({
      where: { claimToken },
      include: { session: true },
    });

    if (!result) {
      return NextResponse.json(
        { error: { message: "Invalid or expired claim token" } },
        { status: 404 }
      );
    }

    if (result.userId || result.session.userId) {
      return NextResponse.json(
        { error: { message: "Result is already claimed" } },
        { status: 400 }
      );
    }

    // Atomically claim result and session, and nullify the claim token
    await db.$transaction([
      db.testResult.update({
        where: { id: result.id },
        data: { userId: user.id, claimToken: null },
      }),
      db.testSession.update({
        where: { id: result.sessionId },
        data: { userId: user.id },
      }),
    ]);

    return NextResponse.json({ success: true, shareId: result.shareId });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });
    }
    console.error("Claim error:", err);
    return NextResponse.json(
      { error: { message: "Internal server error" } },
      { status: 500 }
    );
  }
}
