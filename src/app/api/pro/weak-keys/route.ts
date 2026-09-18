import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/server/services/auth.service";
import { requirePro } from "@/server/services/subscription.service";
import { rateLimit } from "@/server/middleware/rateLimit";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";
    const { success } = await rateLimit(`weak_keys_${ip}`, 30, 60000);
    if (!success) {
      return NextResponse.json(
        { error: { code: "RATE_LIMITED", message: "Too many requests" } },
        { status: 429 }
      );
    }

    const user = await requireAuthenticatedUser();

    // Gated Pro endpoint enforcement
    await requirePro(user.id);

    // Simulated advanced analytics response
    return NextResponse.json({
      success: true,
      weakKeys: [
        { key: "p", errorRate: 0.12 },
        { key: "x", errorRate: 0.08 },
      ],
    });
  } catch (err: unknown) {
    const error = err as Error;
    if (error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error.message === "PRO_REQUIRED") {
      return NextResponse.json({ error: "Pro subscription required" }, { status: 403 });
    }
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
