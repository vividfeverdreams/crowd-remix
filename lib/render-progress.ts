export function normalizeVideoProgress(progress: unknown, previousProgress = 0) {
  if (typeof progress !== "number" || !Number.isFinite(progress)) {
    return previousProgress;
  }

  return Math.max(previousProgress, Math.min(100, Math.max(0, Math.round(progress))));
}
