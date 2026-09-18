import { NextResponse } from "next/server";
import {
  requireOrganizationMember,
  getOrganizationMembers,
} from "@/server/services/organization.service";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const p = await params;
  try {
    const ctx = await requireOrganizationMember(p.orgId);
    const members = await getOrganizationMembers(p.orgId);
    return NextResponse.json({ org: ctx.organization, members });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
}
