import { NextResponse } from "next/server";
import { StartSessionSchema } from "@/schemas/session.schema";
import { startSession } from "@/server/services/session.service";
import { rateLimit } from "@/server/middleware/rateLimit";
import { logger } from "@/lib/logger";
import { isServiceError } from "@/server/errors";

export async function POST(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";
    const { success } = await rateLimit(`start_session_${ip}`, 30, 60000);

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

    const body = await req.json();
    const parsed = StartSessionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            requestId: crypto.randomUUID(),
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
  } catch (error: any) {
    // eslint-disable-line @typescript-eslint/no-explicit-any
    logger.error("Failed to start session", { error: error.message });

    if (isServiceError(error)) {
      return NextResponse.json(
        {
          error: {
            requestId: crypto.randomUUID(),
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
          requestId: crypto.randomUUID(),
          code: "INTERNAL_ERROR",
          message: "Failed to start session.",
        },
      },
      { status: 500 }
    );
  }
}
