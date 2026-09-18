import { requireOrganizationMember } from "@/server/services/organization.service";
import { db } from "@/server/db";

export default async function CandidatesPage(props: { params: Promise<{ orgId: string }> }) {
  const params = await props.params;
  await requireOrganizationMember(params.orgId);
  
  const candidates = await db.assessmentCandidate.findMany({
    where: { assessment: { orgId: params.orgId } },
    include: { assessment: true, result: true },
    orderBy: { invitedAt: "desc" }
  });

  return (
    <div className="p-8 space-y-6">
      <h1 className="text-3xl font-bold">Candidates</h1>
      <div className="space-y-4">
        {candidates.map(c => (
          <div key={c.id} className="p-4 bg-surface rounded-lg">
            <div className="flex justify-between">
              <p className="font-bold">{c.email}</p>
              <p className="text-sm font-mono text-muted">{c.assessment.title}</p>
            </div>
            <p className="text-sm text-muted mt-1">Status: {c.status}</p>
            {c.result && (
              <p className="text-sm text-green-400 mt-2">WPM: {c.result.wpm} | Accuracy: {c.result.accuracy}%</p>
            )}
          </div>
        ))}
        {candidates.length === 0 && <p className="text-muted">No candidates found.</p>}
      </div>
    </div>
  );
}
