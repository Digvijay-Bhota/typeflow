import { requireOrganizationMember } from "@/server/services/organization.service";
import Link from "next/link";
import { db } from "@/server/db";

export default async function OrgDashboardPage(props: {
  params: Promise<{ orgId: string }>;
}) {
  const params = await props.params;
  const ctx = await requireOrganizationMember(params.orgId);
  const assessmentsCount = await db.assessment.count({ where: { orgId: params.orgId } });

  return (
    <div className="space-y-6 p-8">
      <h1 className="text-3xl font-bold">Dashboard: {ctx.organization.name}</h1>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <div className="bg-surface rounded-lg p-6">
          <h2 className="text-xl font-semibold">Assessments</h2>
          <p className="mt-4 font-mono text-4xl">{assessmentsCount}</p>
          <Link
            href={`/org/${params.orgId}/assessments`}
            className="text-accent mt-4 inline-block hover:underline"
          >
            View Assessments
          </Link>
        </div>
        <div className="bg-surface rounded-lg p-6">
          <h2 className="text-xl font-semibold">Candidates</h2>
          <Link
            href={`/org/${params.orgId}/candidates`}
            className="text-accent mt-4 inline-block hover:underline"
          >
            Manage Candidates
          </Link>
        </div>
        <div className="bg-surface rounded-lg p-6">
          <h2 className="text-xl font-semibold">Settings</h2>
          <Link
            href={`/org/${params.orgId}/settings`}
            className="text-accent mt-4 inline-block hover:underline"
          >
            Organization Settings
          </Link>
        </div>
      </div>
    </div>
  );
}
