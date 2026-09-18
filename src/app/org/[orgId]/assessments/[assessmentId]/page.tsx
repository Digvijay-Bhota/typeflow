import { requireOrganizationMember } from "@/server/services/organization.service";
import { db } from "@/server/db";

export default async function AssessmentDetailPage(props: { params: Promise<{ orgId: string, assessmentId: string }> }) {
  const params = await props.params;
  await requireOrganizationMember(params.orgId);
  
  const assessment = await db.assessment.findUnique({
    where: { id: params.assessmentId },
    include: { candidates: true }
  });

  if (!assessment || assessment.orgId !== params.orgId) return <div>Not found</div>;

  return (
    <div className="p-8 space-y-6">
      <h1 className="text-3xl font-bold">{assessment.title}</h1>
      <p className="text-muted">{assessment.description}</p>
      
      <div className="grid grid-cols-2 gap-4 text-sm mt-4">
        <div><span className="text-muted">Status:</span> {assessment.status}</div>
        <div><span className="text-muted">Mode:</span> {assessment.testMode}</div>
        <div><span className="text-muted">Language:</span> {assessment.language}</div>
        <div><span className="text-muted">Duration:</span> {assessment.duration}s</div>
      </div>

      <div className="mt-8">
        <h2 className="text-2xl font-bold mb-4">Candidates</h2>
        <div className="space-y-4">
          {assessment.candidates.map(c => (
            <div key={c.id} className="p-4 bg-surface rounded-lg flex justify-between">
              <div>
                <p className="font-bold">{c.email}</p>
                <p className="text-sm text-muted">Status: {c.status}</p>
              </div>
            </div>
          ))}
          {assessment.candidates.length === 0 && <p className="text-muted">No candidates yet.</p>}
        </div>
      </div>
    </div>
  );
}
