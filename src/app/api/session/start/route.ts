import { NextResponse } from "next/server";
import { StartSessionSchema } from "@/schemas/session.schema";
import { startSession } from "@/server/services/session.service";
import { rateLimit } from "@/server/middleware/rateLimit";
import { logger } from "@/lib/logger";

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

    if (
      error.message.includes("Session not found") ||
      error.message.includes("Session is already") ||
      error.message.includes("expired")
    ) {
      return NextResponse.json(
        {
          error: {
            requestId: crypto.randomUUID(),
            code: "INVALID_SESSION",
            message: error.message,
          },
        },
        { status: 400 }
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
