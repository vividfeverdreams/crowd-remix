ALTER TABLE "dream_sequence"."DJSession"
ADD COLUMN IF NOT EXISTS "videoModel" TEXT NOT NULL DEFAULT 'gemini_omni_flash';
