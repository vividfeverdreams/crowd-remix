export function normalizeVideoProgress(progress: unknown, previousProgress = 0) {
  if (typeof progress !== "number" || !Number.isFinite(progress)) {
    return previousProgress;
  }

  return Math.max(previousProgress, Math.min(100, Math.max(0, Math.round(progress))));
}

export const maximumEstimatedVideoProgress = 95;

export function estimateVideoRenderProgress({
  status,
  createdAt,
  previousProgress = 0,
  now = Date.now()
}: {
  status: "queued" | "in_progress";
  createdAt: Date | string;
  previousProgress?: number;
  now?: number;
}) {
  const createdAtMs =
    createdAt instanceof Date ? createdAt.getTime() : new Date(createdAt).getTime();
  const elapsedMs = Number.isFinite(createdAtMs)
    ? Math.max(0, now - createdAtMs)
    : 0;
  const phaseStart = status === "queued" ? 5 : 20;
  const phaseCeiling =
    status === "queued" ? 20 : maximumEstimatedVideoProgress;
  const expectedPhaseDurationMs = status === "queued" ? 30_000 : 120_000;
  const elapsedShare = Math.min(1, elapsedMs / expectedPhaseDurationMs);
  const estimatedProgress = Math.round(
    phaseStart + (phaseCeiling - phaseStart) * elapsedShare
  );
  const normalizedPrevious = Math.min(
    maximumEstimatedVideoProgress,
    Math.max(0, Math.round(previousProgress))
  );

  return Math.max(normalizedPrevious, estimatedProgress);
}
