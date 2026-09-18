-- CreateIndex
CREATE INDEX "assessment_candidates_assessmentId_invitedAt_id_idx" ON "assessment_candidates"("assessmentId", "invitedAt" DESC, "id" DESC);
