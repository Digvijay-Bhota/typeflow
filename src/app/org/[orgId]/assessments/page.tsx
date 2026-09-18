import { requireOrganizationMember } from "@/server/services/organization.service";
import Link from "next/link";
import { db } from "@/server/db";

export default async function AssessmentsPage(props: { params: Promise<{ orgId: string }> }) {
  const params = await props.params;
  await requireOrganizationMember(params.orgId);
  
  const assessments = await db.assessment.findMany({ 
    where: { orgId: params.orgId },
    orderBy: { createdAt: "desc" }
  });

  return (
    <div className="p-8 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Assessments</h1>
        {/* Simple create button placeholder */}
        <button className="bg-accent px-4 py-2 rounded">Create New</button>
      </div>
      
      <div className="space-y-4">
        {assessments.map(a => (
          <div key={a.id} className="p-4 bg-surface rounded-lg flex justify-between items-center">
            <div>
              <Link href={`/org/${params.orgId}/assessments/${a.id}`} className="text-xl font-bold hover:underline">{a.title}</Link>
              <p className="text-muted text-sm mt-1">Status: {a.status} | Mode: {a.testMode}</p>
            </div>
            <Link href={`/org/${params.orgId}/assessments/${a.id}`} className="text-accent hover:underline">Manage</Link>
          </div>
        ))}
        
        {assessments.length === 0 && (
          <p className="text-muted">No assessments found.</p>
        )}
      </div>
    </div>
  );
}
