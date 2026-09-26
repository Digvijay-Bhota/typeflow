import { NextResponse } from "next/server";
import { SubmitResultSchema } from "@/schemas/result.schema";
import { submitResult } from "@/server/services/session.service";
import { rateLimit } from "@/server/middleware/rateLimit";
import { logRequestFailure } from "@/lib/logger";
import { isServiceError } from "@/server/errors";

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  try {
    const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";
    const { success } = await rateLimit(`submit_result_${ip}`, 10, 60000);

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

    const body = await req.json();
    const parsed = SubmitResultSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            requestId,
            code: "VALIDATION_ERROR",
            message: "Invalid request payload.",
            details: parsed.error.issues,
          },
        },
        { status: 400 }
      );
    }

    const result = await submitResult(parsed.data);

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    logRequestFailure("Failed to submit result", error, {
      requestId,
      route: "POST /api/result",
    });

    if (isServiceError(error)) {
      return NextResponse.json(
        {
          error: {
            requestId,
            code: error.code,
            message: error.message,
          },
        },
        { status: error.status }
      );
    }

    return NextResponse.json(
      {
        error: {
          requestId,
          code: "INTERNAL_ERROR",
          message: "Failed to submit result.",
        },
      },
      { status: 500 }
    );
  }
}
