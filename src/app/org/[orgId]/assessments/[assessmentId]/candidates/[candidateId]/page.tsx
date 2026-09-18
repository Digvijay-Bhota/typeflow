import { requireOrganizationMember } from "@/server/services/organization.service";
import { db } from "@/server/db";
import Link from "next/link";

export default async function CandidateReviewPage(props: {
  params: Promise<{ orgId: string; assessmentId: string; candidateId: string }>;
}) {
  const params = await props.params;
  await requireOrganizationMember(params.orgId);

  const candidate: any = await db.assessmentCandidate.findUnique({
    where: { id: params.candidateId },
    include: {
      result: true,
      assessment: true,
      attempts: true,
    },
  });

  if (!candidate || candidate.assessment.orgId !== params.orgId)
    return <div>Not found</div>;

  return (
    <div className="space-y-6 p-8">
      <Link
        href={`/org/${params.orgId}/assessments/${params.assessmentId}`}
        className="text-accent hover:underline"
      >
        &larr; Back to Assessment
      </Link>
      <h1 className="text-3xl font-bold">Candidate: {candidate.email}</h1>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <span className="text-muted">Status:</span> {candidate.status}
        </div>
        <div>
          <span className="text-muted">Invited At:</span>{" "}
          {candidate.invitedAt.toLocaleDateString()}
        </div>
        <div>
          <span className="text-muted">Total Attempts:</span> {candidate.attempts.length}
        </div>
      </div>

      {candidate.result ? (
        <div className="bg-surface mt-8 space-y-4 rounded-lg p-6">
          <h2 className="text-2xl font-bold">Test Result</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div>
              <p className="text-muted text-sm">WPM</p>
              <p className="text-2xl font-bold">{candidate.result.wpm}</p>
            </div>
            <div>
              <p className="text-muted text-sm">Net WPM</p>
              <p className="text-2xl font-bold">{candidate.result.netWpm}</p>
            </div>
            <div>
              <p className="text-muted text-sm">Accuracy</p>
              <p className="text-2xl font-bold">{candidate.result.accuracy}%</p>
            </div>
            <div>
              <p className="text-muted text-sm">Duration</p>
              <p className="text-2xl font-bold">{candidate.result.duration}s</p>
            </div>
          </div>
          <div className="border-border text-muted mt-4 grid grid-cols-2 gap-2 border-t pt-4 text-sm">
            <p>
              Language: {candidate.assessment.language}{" "}
              {candidate.assessment.codeLanguage
                ? `(${candidate.assessment.codeLanguage})`
                : ""}
            </p>
            <p>Integrity Status: {candidate.result.trustTier}</p>
            <p>Completed: {candidate.result.completedAt.toLocaleString()}</p>
          </div>
        </div>
      ) : (
        <div className="bg-surface text-muted mt-8 rounded-lg p-6">
          No result submitted yet.
        </div>
      )}

      <div className="bg-surface mt-8 rounded-lg p-6">
        <h3 className="mb-4 text-xl font-bold">Reviewer Notes</h3>
        <textarea
          className="bg-tf-neutral-800 min-h-[100px] w-full rounded p-4"
          placeholder="Add private notes..."
          defaultValue={candidate.reviewerNotes || ""}
          disabled
        ></textarea>
        <p className="text-muted mt-2 text-xs">API integration needed to save notes.</p>
      </div>
    </div>
  );
}
