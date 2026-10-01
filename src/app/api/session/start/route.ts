import { NextResponse } from "next/server";
import { StartSessionSchema } from "@/schemas/session.schema";
import { startSession } from "@/server/services/session.service";
import { rateLimit } from "@/server/middleware/rateLimit";
import { logRequestFailure } from "@/lib/logger";
import { isServiceError } from "@/server/errors";

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  try {
    const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";
    const { success } = await rateLimit(`start_session_${ip}`, 30, 60000, "FAIL_OPEN");

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
    const parsed = StartSessionSchema.safeParse(body);

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

    const session = await startSession(parsed.data);

    return NextResponse.json(session, { status: 200 });
  } catch (error) {
    logRequestFailure("Failed to start session", error, {
      requestId,
      route: "POST /api/session/start",
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
          message: "Failed to start session.",
        },
      },
      { status: 500 }
    );
  }
}
