import { requireOrganizationMember } from "@/server/services/organization.service";
import { db } from "@/server/db";

export default async function CandidatesPage(props: {
  params: Promise<{ orgId: string }>;
}) {
  const params = await props.params;
  await requireOrganizationMember(params.orgId);

  const candidates = await db.assessmentCandidate.findMany({
    where: { assessment: { orgId: params.orgId } },
    include: { assessment: true, result: true },
    orderBy: { invitedAt: "desc" },
  });

  return (
    <div className="space-y-6 p-8">
      <h1 className="text-3xl font-bold">Candidates</h1>
      <div className="space-y-4">
        {candidates.map((c) => (
          <div key={c.id} className="bg-surface rounded-lg p-4">
            <div className="flex justify-between">
              <p className="font-bold">{c.email}</p>
              <p className="text-muted font-mono text-sm">{c.assessment.title}</p>
            </div>
            <p className="text-muted mt-1 text-sm">Status: {c.status}</p>
            {c.result && (
              <p className="mt-2 text-sm text-green-400">
                WPM: {c.result.wpm} | Accuracy: {c.result.accuracy}%
              </p>
            )}
          </div>
        ))}
        {candidates.length === 0 && <p className="text-muted">No candidates found.</p>}
      </div>
    </div>
  );
}
