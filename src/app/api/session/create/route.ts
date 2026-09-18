import { NextResponse } from "next/server";
import { CreateSessionSchema } from "@/schemas/session.schema";
import { createSession } from "@/server/services/session.service";
import { rateLimit } from "@/server/middleware/rateLimit";
import { logger } from "@/lib/logger";

export async function POST(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";
    const { success, remaining, limit, reset } = await rateLimit(`create_session_${ip}`, 10, 60000);
    
    if (!success) {
      return NextResponse.json(
        { error: { requestId: crypto.randomUUID(), code: "RATE_LIMITED", message: "Too many requests." } },
        { status: 429, headers: { "X-RateLimit-Limit": limit.toString(), "X-RateLimit-Remaining": remaining.toString(), "X-RateLimit-Reset": reset.toString() } }
      );
    }

    const body = await req.json();
    const parsed = CreateSessionSchema.safeParse(body);
    
    if (!parsed.success) {
      return NextResponse.json(
        { error: { requestId: crypto.randomUUID(), code: "VALIDATION_ERROR", message: "Invalid request payload.", details: parsed.error.issues } },
        { status: 400 }
      );
    }

    const session = await createSession(parsed.data);

    return NextResponse.json(session, { status: 201 });
  } catch (error: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
    logger.error("Failed to create session", { error: error.message });
    return NextResponse.json(
      { error: { requestId: crypto.randomUUID(), code: "INTERNAL_ERROR", message: "Failed to create session." } },
      { status: 500 }
    );
  }
}
