ALTER TABLE "dream_sequence"."PromptSubmission"
  ADD COLUMN IF NOT EXISTS "referenceImageUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "referenceImageStoragePath" TEXT,
  ADD COLUMN IF NOT EXISTS "referenceImageMimeType" TEXT;

ALTER TABLE "dream_sequence"."RenderJob"
  ADD COLUMN IF NOT EXISTS "providerOutputUri" TEXT,
  ADD COLUMN IF NOT EXISTS "providerStrategy" TEXT;
