import { requireOrganizationMember } from "@/server/services/organization.service";
import { db } from "@/server/db";

export default async function AssessmentDetailPage(props: {
  params: Promise<{ orgId: string; assessmentId: string }>;
}) {
  const params = await props.params;
  await requireOrganizationMember(params.orgId);

  const assessment = await db.assessment.findUnique({
    where: { id: params.assessmentId },
    include: { candidates: true },
  });

  if (!assessment || assessment.orgId !== params.orgId) return <div>Not found</div>;

  return (
    <div className="space-y-6 p-8">
      <h1 className="text-3xl font-bold">{assessment.title}</h1>
      <p className="text-muted">{assessment.description}</p>

      <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
        <div>
          <span className="text-muted">Status:</span> {assessment.status}
        </div>
        <div>
          <span className="text-muted">Mode:</span> {assessment.testMode}
        </div>
        <div>
          <span className="text-muted">Language:</span> {assessment.language}
        </div>
        <div>
          <span className="text-muted">Duration:</span> {assessment.duration}s
        </div>
      </div>

      <div className="mt-8">
        <h2 className="mb-4 text-2xl font-bold">Candidates</h2>
        <div className="space-y-4">
          {assessment.candidates.map((c) => (
            <div key={c.id} className="bg-surface flex justify-between rounded-lg p-4">
              <div>
                <p className="font-bold">{c.email}</p>
                <p className="text-muted text-sm">Status: {c.status}</p>
              </div>
            </div>
          ))}
          {assessment.candidates.length === 0 && (
            <p className="text-muted">No candidates yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
