-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "dream_sequence";

-- CreateTable
CREATE TABLE "dream_sequence"."User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dream_sequence"."DJSession" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "artistName" TEXT NOT NULL,
    "trackName" TEXT NOT NULL,
    "creativeBible" TEXT NOT NULL,
    "allowedMotifs" TEXT NOT NULL,
    "bannedTerms" TEXT NOT NULL,
    "colorPalette" TEXT NOT NULL,
    "motionRules" TEXT NOT NULL,
    "basePrompt" TEXT NOT NULL,
    "imageReferenceUrl" TEXT,
    "smsNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "venueSafeMode" BOOLEAN NOT NULL DEFAULT true,
    "autoSelectEnabled" BOOLEAN NOT NULL DEFAULT true,
    "startedAt" TIMESTAMP(3),
    "stoppedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DJSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dream_sequence"."PromptSubmission" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sender" TEXT,
    "senderFingerprint" TEXT NOT NULL,
    "messageSid" TEXT,
    "rawText" TEXT NOT NULL,
    "normalizedText" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "approvalReason" TEXT,
    "selectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromptSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dream_sequence"."ModerationResult" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "flags" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModerationResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dream_sequence"."RankingResult" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "noveltyScore" INTEGER NOT NULL,
    "cohesionScore" INTEGER NOT NULL,
    "remixDeltaScore" INTEGER NOT NULL,
    "winningPrompt" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RankingResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dream_sequence"."VisualAsset" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "sourceSubmissionId" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "promptText" TEXT NOT NULL,
    "storagePath" TEXT,
    "publicUrl" TEXT,
    "thumbnailUrl" TEXT,
    "sourceVideoId" TEXT,
    "durationSeconds" INTEGER NOT NULL DEFAULT 8,
    "width" INTEGER NOT NULL DEFAULT 1280,
    "height" INTEGER NOT NULL DEFAULT 720,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisualAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dream_sequence"."RenderJob" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "submissionId" TEXT,
    "sourceAssetId" TEXT,
    "outputAssetId" TEXT,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "openaiVideoId" TEXT,
    "promptText" TEXT NOT NULL,
    "failureReason" TEXT,
    "lastPolledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RenderJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dream_sequence"."PlaybackState" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "currentAssetId" TEXT,
    "nextAssetId" TEXT,
    "fallbackAssetId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "emergencyPaused" BOOLEAN NOT NULL DEFAULT false,
    "crossfadeSeconds" DOUBLE PRECISION NOT NULL DEFAULT 2.0,
    "lastTransitionAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlaybackState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dream_sequence"."AuditEvent" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT,
    "userId" TEXT,
    "type" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "dream_sequence"."User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "DJSession_code_key" ON "dream_sequence"."DJSession"("code");

-- CreateIndex
CREATE INDEX "DJSession_userId_createdAt_idx" ON "dream_sequence"."DJSession"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PromptSubmission_messageSid_key" ON "dream_sequence"."PromptSubmission"("messageSid");

-- CreateIndex
CREATE INDEX "PromptSubmission_sessionId_createdAt_idx" ON "dream_sequence"."PromptSubmission"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "PromptSubmission_sessionId_status_idx" ON "dream_sequence"."PromptSubmission"("sessionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ModerationResult_submissionId_key" ON "dream_sequence"."ModerationResult"("submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "RankingResult_submissionId_key" ON "dream_sequence"."RankingResult"("submissionId");

-- CreateIndex
CREATE INDEX "VisualAsset_sessionId_createdAt_idx" ON "dream_sequence"."VisualAsset"("sessionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RenderJob_outputAssetId_key" ON "dream_sequence"."RenderJob"("outputAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "RenderJob_openaiVideoId_key" ON "dream_sequence"."RenderJob"("openaiVideoId");

-- CreateIndex
CREATE INDEX "RenderJob_sessionId_status_idx" ON "dream_sequence"."RenderJob"("sessionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PlaybackState_sessionId_key" ON "dream_sequence"."PlaybackState"("sessionId");

-- CreateIndex
CREATE INDEX "AuditEvent_sessionId_createdAt_idx" ON "dream_sequence"."AuditEvent"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_type_createdAt_idx" ON "dream_sequence"."AuditEvent"("type", "createdAt");

-- AddForeignKey
ALTER TABLE "dream_sequence"."DJSession" ADD CONSTRAINT "DJSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "dream_sequence"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dream_sequence"."PromptSubmission" ADD CONSTRAINT "PromptSubmission_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "dream_sequence"."DJSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dream_sequence"."ModerationResult" ADD CONSTRAINT "ModerationResult_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "dream_sequence"."PromptSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dream_sequence"."RankingResult" ADD CONSTRAINT "RankingResult_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "dream_sequence"."PromptSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dream_sequence"."VisualAsset" ADD CONSTRAINT "VisualAsset_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "dream_sequence"."DJSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dream_sequence"."VisualAsset" ADD CONSTRAINT "VisualAsset_sourceSubmissionId_fkey" FOREIGN KEY ("sourceSubmissionId") REFERENCES "dream_sequence"."PromptSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dream_sequence"."RenderJob" ADD CONSTRAINT "RenderJob_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "dream_sequence"."DJSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dream_sequence"."RenderJob" ADD CONSTRAINT "RenderJob_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "dream_sequence"."PromptSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dream_sequence"."RenderJob" ADD CONSTRAINT "RenderJob_sourceAssetId_fkey" FOREIGN KEY ("sourceAssetId") REFERENCES "dream_sequence"."VisualAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dream_sequence"."RenderJob" ADD CONSTRAINT "RenderJob_outputAssetId_fkey" FOREIGN KEY ("outputAssetId") REFERENCES "dream_sequence"."VisualAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dream_sequence"."PlaybackState" ADD CONSTRAINT "PlaybackState_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "dream_sequence"."DJSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dream_sequence"."PlaybackState" ADD CONSTRAINT "PlaybackState_currentAssetId_fkey" FOREIGN KEY ("currentAssetId") REFERENCES "dream_sequence"."VisualAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dream_sequence"."PlaybackState" ADD CONSTRAINT "PlaybackState_nextAssetId_fkey" FOREIGN KEY ("nextAssetId") REFERENCES "dream_sequence"."VisualAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dream_sequence"."PlaybackState" ADD CONSTRAINT "PlaybackState_fallbackAssetId_fkey" FOREIGN KEY ("fallbackAssetId") REFERENCES "dream_sequence"."VisualAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dream_sequence"."AuditEvent" ADD CONSTRAINT "AuditEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "dream_sequence"."DJSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dream_sequence"."AuditEvent" ADD CONSTRAINT "AuditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "dream_sequence"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
