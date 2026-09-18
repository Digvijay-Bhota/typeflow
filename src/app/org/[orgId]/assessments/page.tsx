import { requireOrganizationMember } from "@/server/services/organization.service";
import Link from "next/link";
import { db } from "@/server/db";

export default async function AssessmentsPage(props: {
  params: Promise<{ orgId: string }>;
}) {
  const params = await props.params;
  await requireOrganizationMember(params.orgId);

  const assessments = await db.assessment.findMany({
    where: { orgId: params.orgId },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Assessments</h1>
        {/* Simple create button placeholder */}
        <button className="bg-accent rounded px-4 py-2">Create New</button>
      </div>

      <div className="space-y-4">
        {assessments.map((a) => (
          <div
            key={a.id}
            className="bg-surface flex items-center justify-between rounded-lg p-4"
          >
            <div>
              <Link
                href={`/org/${params.orgId}/assessments/${a.id}`}
                className="text-xl font-bold hover:underline"
              >
                {a.title}
              </Link>
              <p className="text-muted mt-1 text-sm">
                Status: {a.status} | Mode: {a.testMode}
              </p>
            </div>
            <Link
              href={`/org/${params.orgId}/assessments/${a.id}`}
              className="text-accent hover:underline"
            >
              Manage
            </Link>
          </div>
        ))}

        {assessments.length === 0 && <p className="text-muted">No assessments found.</p>}
      </div>
    </div>
  );
}
