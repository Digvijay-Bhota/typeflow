import { NextResponse } from "next/server";
import { SubmitResultSchema } from "@/schemas/result.schema";
import { submitResult } from "@/server/services/session.service";
import { rateLimit } from "@/server/middleware/rateLimit";
import { logger } from "@/lib/logger";

export async function POST(req: Request) {
  try {
    const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";
    const { success } = await rateLimit(`submit_result_${ip}`, 10, 60000);
    
    if (!success) {
      return NextResponse.json({ error: { requestId: crypto.randomUUID(), code: "RATE_LIMITED", message: "Too many requests." } }, { status: 429 });
    }

    const body = await req.json();
    const parsed = SubmitResultSchema.safeParse(body);
    
    if (!parsed.success) {
      return NextResponse.json({ error: { requestId: crypto.randomUUID(), code: "VALIDATION_ERROR", message: "Invalid request payload.", details: parsed.error.issues } }, { status: 400 });
    }

    const result = await submitResult(parsed.data);

    return NextResponse.json(result, { status: 201 });
  } catch (error: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
    logger.error("Failed to submit result", { error: error.message });
    
    if (
      error.message.includes("Session not found") || 
      error.message.includes("not ACTIVE") || 
      error.message.includes("expired") || 
      error.message.includes("duration exceeded grace period")
    ) {
      return NextResponse.json({ error: { requestId: crypto.randomUUID(), code: "INVALID_SESSION", message: error.message } }, { status: 400 });
    }

    return NextResponse.json({ error: { requestId: crypto.randomUUID(), code: "INTERNAL_ERROR", message: "Failed to submit result." } }, { status: 500 });
  }
}
