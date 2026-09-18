import { NextResponse } from "next/server";
import { getResultByShareId } from "@/server/services/result.service";
import { rateLimit } from "@/server/middleware/rateLimit";
import { logger } from "@/lib/logger";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ shareId: string }> }
) {
  try {
    const shareId = (await params).shareId;

    if (!shareId || typeof shareId !== "string") {
      return NextResponse.json(
        {
          error: {
            requestId: crypto.randomUUID(),
            code: "VALIDATION_ERROR",
            message: "Invalid shareId.",
          },
        },
        { status: 400 }
      );
    }

    const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";
    const { success } = await rateLimit(`get_result_${ip}`, 60, 60000);

    if (!success) {
      return NextResponse.json(
        {
          error: {
            requestId: crypto.randomUUID(),
            code: "RATE_LIMITED",
            message: "Too many requests.",
          },
        },
        { status: 429 }
      );
    }

    const result = await getResultByShareId(shareId);

    if (!result) {
      return NextResponse.json(
        {
          error: {
            requestId: crypto.randomUUID(),
            code: "NOT_FOUND",
            message: "Result not found.",
          },
        },
        { status: 404 }
      );
    }

    return NextResponse.json(result, { status: 200 });
  } catch (error: any) {
    // eslint-disable-line @typescript-eslint/no-explicit-any
    logger.error("Failed to retrieve result", { error: error.message });
    return NextResponse.json(
      {
        error: {
          requestId: crypto.randomUUID(),
          code: "INTERNAL_ERROR",
          message: "Failed to retrieve result.",
        },
      },
      { status: 500 }
    );
  }
}
