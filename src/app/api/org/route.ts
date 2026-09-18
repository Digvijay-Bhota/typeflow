import { rateLimit } from "@/server/middleware/rateLimit";
import { NextResponse } from "next/server";
import { createOrganization } from "@/server/services/organization.service";
import { z } from "zod";

const CreateOrgSchema = z.object({
  name: z.string().min(2).max(100),
  slug: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/),
});

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";
  const { success } = await rateLimit(`org_create_${ip}`, 5, 60000);
  if (!success) return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });

  try {
    const json = await req.json();
    const data = CreateOrgSchema.parse(json);
    const org = await createOrganization(data);
    return NextResponse.json({ org });
  } catch (error: any) {
    if (error.message === "SLUG_TAKEN") {
      return NextResponse.json({ error: "Slug already taken" }, { status: 400 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
