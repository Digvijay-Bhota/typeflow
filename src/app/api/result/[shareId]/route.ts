import { NextResponse } from "next/server";
import { getResultByShareId } from "@/server/services/result.service";
import { getAuthenticatedUser } from "@/server/services/auth.service";
import { rateLimit } from "@/server/middleware/rateLimit";
import { logRequestFailure } from "@/lib/logger";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ shareId: string }> }
) {
  const requestId = crypto.randomUUID();
  try {
    const shareId = (await params).shareId;

    if (!shareId || typeof shareId !== "string") {
      return NextResponse.json(
        {
          error: {
            requestId,
            code: "VALIDATION_ERROR",
            message: "Invalid shareId.",
          },
        },
        { status: 400 }
      );
    }

    const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";
    const { success } = await rateLimit(`get_result_${ip}`, 60, 60000, "FAIL_OPEN");

    if (!success) {
      return NextResponse.json(
        {
          error: {
            requestId,
            code: "RATE_LIMITED",
            message: "Too many requests.",
          },
        },
        { status: 429 }
      );
    }

    const viewer = await getAuthenticatedUser().catch(() => null);
    const result = await getResultByShareId(
      shareId,
      viewer ? { viewerId: viewer.id } : undefined
    );

    if (!result) {
      return NextResponse.json(
        {
          error: {
            requestId,
            code: "NOT_FOUND",
            message: "Result not found.",
          },
        },
        { status: 404 }
      );
    }

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    logRequestFailure("Failed to retrieve result", error, {
      requestId,
      route: "GET /api/result/[shareId]",
    });
    return NextResponse.json(
      {
        error: {
          requestId,
          code: "INTERNAL_ERROR",
          message: "Failed to retrieve result.",
        },
      },
      { status: 500 }
    );
  }
}
