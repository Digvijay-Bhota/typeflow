import { requireOrganizationMember } from "@/server/services/organization.service";
import { db } from "@/server/db";
import Link from "next/link";

export default async function CandidateReviewPage(props: { params: Promise<{ orgId: string, assessmentId: string, candidateId: string }> }) {
  const params = await props.params;
  await requireOrganizationMember(params.orgId);
  
  const candidate: any = await db.assessmentCandidate.findUnique({
    where: { id: params.candidateId },
    include: {
      result: true,
      assessment: true,
      attempts: true
    }
  });

  if (!candidate || candidate.assessment.orgId !== params.orgId) return <div>Not found</div>;

  return (
    <div className="p-8 space-y-6">
      <Link href={`/org/${params.orgId}/assessments/${params.assessmentId}`} className="text-accent hover:underline">&larr; Back to Assessment</Link>
      <h1 className="text-3xl font-bold">Candidate: {candidate.email}</h1>
      <div className="grid grid-cols-2 gap-4">
        <div><span className="text-muted">Status:</span> {candidate.status}</div>
        <div><span className="text-muted">Invited At:</span> {candidate.invitedAt.toLocaleDateString()}</div>
        <div><span className="text-muted">Total Attempts:</span> {candidate.attempts.length}</div>
      </div>
      
      {candidate.result ? (
        <div className="mt-8 bg-surface p-6 rounded-lg space-y-4">
          <h2 className="text-2xl font-bold">Test Result</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
          <div className="mt-4 pt-4 border-t border-border text-sm text-muted grid grid-cols-2 gap-2">
             <p>Language: {candidate.assessment.language} {candidate.assessment.codeLanguage ? `(${candidate.assessment.codeLanguage})` : ""}</p>
             <p>Integrity Status: {candidate.result.trustTier}</p>
             <p>Completed: {candidate.result.completedAt.toLocaleString()}</p>
          </div>
        </div>
      ) : (
         <div className="mt-8 bg-surface p-6 rounded-lg text-muted">
           No result submitted yet.
         </div>
      )}

      <div className="mt-8 bg-surface p-6 rounded-lg">
        <h3 className="text-xl font-bold mb-4">Reviewer Notes</h3>
        <textarea 
          className="w-full bg-tf-neutral-800 p-4 rounded min-h-[100px]" 
          placeholder="Add private notes..."
          defaultValue={candidate.reviewerNotes || ""}
          disabled
        ></textarea>
        <p className="text-xs text-muted mt-2">API integration needed to save notes.</p>
      </div>
    </div>
  );
}
