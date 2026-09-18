-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'PRO', 'ADMIN');

-- CreateEnum
CREATE TYPE "TypingMode" AS ENUM ('TIMED', 'WORDS', 'ZEN', 'CODE', 'CERTIFICATE', 'PRACTICE');

-- CreateEnum
CREATE TYPE "TrustTier" AS ENUM ('FREE', 'CERTIFICATE', 'B2B_ASSESSMENT');

-- CreateEnum
CREATE TYPE "Language" AS ENUM ('ENGLISH', 'HINDI', 'CODE');

-- CreateEnum
CREATE TYPE "CodeLanguage" AS ENUM ('JAVASCRIPT', 'TYPESCRIPT', 'PYTHON', 'JAVA', 'CPP', 'SQL');

-- CreateEnum
CREATE TYPE "Difficulty" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED');

-- CreateEnum
CREATE TYPE "PassageMode" AS ENUM ('NORMAL', 'CODE', 'PRACTICE', 'CERTIFICATE');

-- CreateEnum
CREATE TYPE "TestSessionStatus" AS ENUM ('PENDING', 'ACTIVE', 'COMPLETED', 'EXPIRED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "IntegrityStatus" AS ENUM ('VERIFIED', 'REVIEW', 'INVALID');

-- CreateEnum
CREATE TYPE "CertificateStatus" AS ENUM ('PENDING_PAYMENT', 'ACTIVE', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('RAZORPAY');

-- CreateEnum
CREATE TYPE "SubscriptionPlan" AS ENUM ('FREE', 'PRO');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('PENDING_CREATION', 'TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "OrganizationRole" AS ENUM ('OWNER', 'ADMIN', 'RECRUITER', 'REVIEWER', 'MEMBER');

-- CreateEnum
CREATE TYPE "AssessmentStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'PAUSED', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CandidateStatus" AS ENUM ('INVITED', 'STARTED', 'COMPLETED', 'EXPIRED', 'DISQUALIFIED');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('STARTED', 'COMPLETED', 'ABANDONED', 'INVALIDATED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "authId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" VARCHAR(100),
    "avatarUrl" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "leaderboardOptOut" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "passages" (
    "id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "language" "Language" NOT NULL DEFAULT 'ENGLISH',
    "category" VARCHAR(100),
    "difficulty" "Difficulty" NOT NULL DEFAULT 'INTERMEDIATE',
    "mode" "PassageMode" NOT NULL DEFAULT 'NORMAL',
    "wordCount" INTEGER NOT NULL,
    "charCount" INTEGER NOT NULL,
    "codeLanguage" "CodeLanguage",
    "sourceAttribution" VARCHAR(500),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "passages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_sessions" (
    "id" UUID NOT NULL,
    "integrityToken" VARCHAR(128) NOT NULL,
    "userId" UUID,
    "passageId" UUID NOT NULL,
    "mode" "TypingMode" NOT NULL,
    "language" "Language" NOT NULL,
    "codeLanguage" "CodeLanguage",
    "trustTier" "TrustTier" NOT NULL DEFAULT 'FREE',
    "duration" INTEGER,
    "wordCount" INTEGER,
    "status" "TestSessionStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "test_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_results" (
    "id" UUID NOT NULL,
    "shareId" VARCHAR(21) NOT NULL,
    "sessionId" UUID NOT NULL,
    "userId" UUID,
    "wpm" DOUBLE PRECISION NOT NULL,
    "rawWpm" DOUBLE PRECISION NOT NULL,
    "netWpm" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION NOT NULL,
    "consistency" DOUBLE PRECISION,
    "correctChars" INTEGER NOT NULL,
    "incorrectChars" INTEGER NOT NULL,
    "totalChars" INTEGER NOT NULL,
    "correctedErrors" INTEGER NOT NULL,
    "uncorrectedErrors" INTEGER NOT NULL,
    "totalKeystrokes" INTEGER,
    "errorMap" JSONB,
    "codeMetrics" JSONB,
    "integrityStatus" "IntegrityStatus" NOT NULL DEFAULT 'VERIFIED',
    "integritySignals" JSONB,
    "eventTrace" JSONB,
    "claimToken" VARCHAR(128),
    "elapsedMs" INTEGER NOT NULL,
    "duration" INTEGER,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "test_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "practice_sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "mode" VARCHAR(50) NOT NULL,
    "focusKeys" VARCHAR(10)[],
    "language" "Language" NOT NULL DEFAULT 'ENGLISH',
    "exerciseType" VARCHAR(100) NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "practice_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_key_stats" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "key" VARCHAR(10) NOT NULL,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "correctedCount" INTEGER NOT NULL DEFAULT 0,
    "totalOccurrences" INTEGER NOT NULL DEFAULT 0,
    "accuracyRate" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_key_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificates" (
    "id" UUID NOT NULL,
    "certificateId" VARCHAR(20) NOT NULL,
    "verificationHash" VARCHAR(128) NOT NULL,
    "userId" UUID NOT NULL,
    "resultId" UUID NOT NULL,
    "status" "CertificateStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "testType" VARCHAR(100) NOT NULL,
    "language" "Language" NOT NULL,
    "duration" INTEGER NOT NULL,
    "wpm" DOUBLE PRECISION NOT NULL,
    "rawWpm" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION NOT NULL,
    "pdfUrl" TEXT,
    "qrData" VARCHAR(500),
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedReason" VARCHAR(500),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "certificateId" UUID,
    "subscriptionId" UUID,
    "provider" "PaymentProvider" NOT NULL DEFAULT 'RAZORPAY',
    "orderId" VARCHAR(200) NOT NULL,
    "paymentId" VARCHAR(200),
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amount" INTEGER NOT NULL,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'INR',
    "idempotencyKey" VARCHAR(200) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_events" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "providerEventId" VARCHAR(200) NOT NULL,
    "eventType" VARCHAR(100) NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "provider" "PaymentProvider" NOT NULL DEFAULT 'RAZORPAY',
    "providerSubscriptionId" VARCHAR(200),
    "providerPlanId" VARCHAR(200),
    "plan" "SubscriptionPlan" NOT NULL DEFAULT 'FREE',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'PENDING_CREATION',
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_events" (
    "id" UUID NOT NULL,
    "subscriptionId" UUID,
    "provider" "PaymentProvider" NOT NULL,
    "providerEventId" VARCHAR(200) NOT NULL,
    "providerSubscriptionId" VARCHAR(200),
    "eventType" VARCHAR(100) NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "subscription_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(200) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "domain" VARCHAR(255),
    "plan" VARCHAR(50) NOT NULL DEFAULT 'STARTER',
    "ownerId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_members" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "OrganizationRole" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessments" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "description" TEXT,
    "testMode" "TypingMode" NOT NULL DEFAULT 'TIMED',
    "language" "Language" NOT NULL DEFAULT 'ENGLISH',
    "codeLanguage" VARCHAR(50),
    "duration" INTEGER NOT NULL,
    "wpmThreshold" INTEGER,
    "accuracyThreshold" DOUBLE PRECISION,
    "maxAttempts" INTEGER NOT NULL DEFAULT 1,
    "status" "AssessmentStatus" NOT NULL DEFAULT 'DRAFT',
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_candidates" (
    "id" UUID NOT NULL,
    "assessmentId" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "name" VARCHAR(200),
    "inviteToken" VARCHAR(128) NOT NULL,
    "status" "CandidateStatus" NOT NULL DEFAULT 'INVITED',
    "expiresAt" TIMESTAMP(3),
    "reviewerNotes" TEXT,
    "resultId" UUID,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assessment_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_attempts" (
    "id" UUID NOT NULL,
    "candidateId" UUID NOT NULL,
    "sessionId" UUID,
    "status" "AttemptStatus" NOT NULL DEFAULT 'STARTED',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "assessment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "action" VARCHAR(100) NOT NULL,
    "resource" VARCHAR(100) NOT NULL,
    "resourceId" VARCHAR(100),
    "ipHash" VARCHAR(128),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_authId_key" ON "users"("authId");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_authId_idx" ON "users"("authId");

-- CreateIndex
CREATE INDEX "users_createdAt_idx" ON "users"("createdAt");

-- CreateIndex
CREATE INDEX "passages_language_mode_difficulty_isActive_idx" ON "passages"("language", "mode", "difficulty", "isActive");

-- CreateIndex
CREATE INDEX "passages_codeLanguage_isActive_idx" ON "passages"("codeLanguage", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "test_sessions_integrityToken_key" ON "test_sessions"("integrityToken");

-- CreateIndex
CREATE INDEX "test_sessions_userId_idx" ON "test_sessions"("userId");

-- CreateIndex
CREATE INDEX "test_sessions_status_idx" ON "test_sessions"("status");

-- CreateIndex
CREATE INDEX "test_sessions_expiresAt_idx" ON "test_sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "test_sessions_trustTier_idx" ON "test_sessions"("trustTier");

-- CreateIndex
CREATE UNIQUE INDEX "test_results_shareId_key" ON "test_results"("shareId");

-- CreateIndex
CREATE UNIQUE INDEX "test_results_sessionId_key" ON "test_results"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "test_results_claimToken_key" ON "test_results"("claimToken");

-- CreateIndex
CREATE INDEX "test_results_userId_createdAt_idx" ON "test_results"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "test_results_shareId_idx" ON "test_results"("shareId");

-- CreateIndex
CREATE INDEX "test_results_integrityStatus_idx" ON "test_results"("integrityStatus");

-- CreateIndex
CREATE INDEX "test_results_netWpm_accuracy_duration_createdAt_idx" ON "test_results"("netWpm", "accuracy", "duration", "createdAt");

-- CreateIndex
CREATE INDEX "practice_sessions_userId_idx" ON "practice_sessions"("userId");

-- CreateIndex
CREATE INDEX "practice_sessions_completedAt_idx" ON "practice_sessions"("completedAt");

-- CreateIndex
CREATE INDEX "user_key_stats_userId_accuracyRate_idx" ON "user_key_stats"("userId", "accuracyRate");

-- CreateIndex
CREATE UNIQUE INDEX "user_key_stats_userId_key_key" ON "user_key_stats"("userId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "certificates_certificateId_key" ON "certificates"("certificateId");

-- CreateIndex
CREATE UNIQUE INDEX "certificates_resultId_key" ON "certificates"("resultId");

-- CreateIndex
CREATE INDEX "certificates_userId_idx" ON "certificates"("userId");

-- CreateIndex
CREATE INDEX "certificates_certificateId_idx" ON "certificates"("certificateId");

-- CreateIndex
CREATE INDEX "certificates_verificationHash_idx" ON "certificates"("verificationHash");

-- CreateIndex
CREATE INDEX "certificates_status_idx" ON "certificates"("status");

-- CreateIndex
CREATE UNIQUE INDEX "payments_certificateId_key" ON "payments"("certificateId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_orderId_key" ON "payments"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotencyKey_key" ON "payments"("idempotencyKey");

-- CreateIndex
CREATE INDEX "payments_userId_idx" ON "payments"("userId");

-- CreateIndex
CREATE INDEX "payments_orderId_idx" ON "payments"("orderId");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "payment_events_providerEventId_key" ON "payment_events"("providerEventId");

-- CreateIndex
CREATE INDEX "payment_events_paymentId_idx" ON "payment_events"("paymentId");

-- CreateIndex
CREATE INDEX "payment_events_providerEventId_idx" ON "payment_events"("providerEventId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_userId_key" ON "subscriptions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_providerSubscriptionId_key" ON "subscriptions"("providerSubscriptionId");

-- CreateIndex
CREATE INDEX "subscriptions_userId_idx" ON "subscriptions"("userId");

-- CreateIndex
CREATE INDEX "subscriptions_status_idx" ON "subscriptions"("status");

-- CreateIndex
CREATE INDEX "subscriptions_providerSubscriptionId_idx" ON "subscriptions"("providerSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_events_providerEventId_key" ON "subscription_events"("providerEventId");

-- CreateIndex
CREATE INDEX "subscription_events_subscriptionId_idx" ON "subscription_events"("subscriptionId");

-- CreateIndex
CREATE INDEX "subscription_events_providerEventId_idx" ON "subscription_events"("providerEventId");

-- CreateIndex
CREATE INDEX "subscription_events_providerSubscriptionId_idx" ON "subscription_events"("providerSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "organizations_ownerId_idx" ON "organizations"("ownerId");

-- CreateIndex
CREATE INDEX "organization_members_orgId_idx" ON "organization_members"("orgId");

-- CreateIndex
CREATE INDEX "organization_members_userId_idx" ON "organization_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "organization_members_orgId_userId_key" ON "organization_members"("orgId", "userId");

-- CreateIndex
CREATE INDEX "assessments_orgId_idx" ON "assessments"("orgId");

-- CreateIndex
CREATE INDEX "assessments_status_idx" ON "assessments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_candidates_inviteToken_key" ON "assessment_candidates"("inviteToken");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_candidates_resultId_key" ON "assessment_candidates"("resultId");

-- CreateIndex
CREATE INDEX "assessment_candidates_assessmentId_idx" ON "assessment_candidates"("assessmentId");

-- CreateIndex
CREATE INDEX "assessment_candidates_inviteToken_idx" ON "assessment_candidates"("inviteToken");

-- CreateIndex
CREATE INDEX "assessment_candidates_email_idx" ON "assessment_candidates"("email");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_attempts_sessionId_key" ON "assessment_attempts"("sessionId");

-- CreateIndex
CREATE INDEX "assessment_attempts_candidateId_idx" ON "assessment_attempts"("candidateId");

-- CreateIndex
CREATE INDEX "audit_logs_userId_idx" ON "audit_logs"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_action_resource_idx" ON "audit_logs"("action", "resource");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "test_sessions" ADD CONSTRAINT "test_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_sessions" ADD CONSTRAINT "test_sessions_passageId_fkey" FOREIGN KEY ("passageId") REFERENCES "passages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_results" ADD CONSTRAINT "test_results_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "test_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_results" ADD CONSTRAINT "test_results_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_sessions" ADD CONSTRAINT "practice_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_key_stats" ADD CONSTRAINT "user_key_stats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "test_results"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_certificateId_fkey" FOREIGN KEY ("certificateId") REFERENCES "certificates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_candidates" ADD CONSTRAINT "assessment_candidates_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "assessments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_candidates" ADD CONSTRAINT "assessment_candidates_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "test_results"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_attempts" ADD CONSTRAINT "assessment_attempts_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "assessment_candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_attempts" ADD CONSTRAINT "assessment_attempts_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "test_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
