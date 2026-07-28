ALTER TABLE "dream_sequence"."DJSession"
ADD COLUMN IF NOT EXISTS "videoDurationSeconds" INTEGER NOT NULL DEFAULT 8;
