export const videoDurationOptions = [4, 6, 8] as const;

export type VideoDurationSeconds = (typeof videoDurationOptions)[number];

export const defaultVideoDurationSeconds: VideoDurationSeconds = 8;

export function isVideoDurationSeconds(value: unknown): value is VideoDurationSeconds {
  return (
    typeof value === "number" &&
    (videoDurationOptions as readonly number[]).includes(value)
  );
}

export function normalizeVideoDurationSeconds(
  value: unknown
): VideoDurationSeconds {
  return isVideoDurationSeconds(value)
    ? value
    : defaultVideoDurationSeconds;
}

export function formatVideoDuration(value: unknown) {
  return `${normalizeVideoDurationSeconds(value)}s`;
}
