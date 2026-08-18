import {
  defaultVideoModelId,
  getVideoDurationOptions,
  getVideoModelDefinition,
  isVideoModelDurationSupported
} from "@/lib/video-models";

export const videoDurationOptions = getVideoDurationOptions(defaultVideoModelId);

export type VideoDurationSeconds = number;

export const defaultVideoDurationSeconds = getVideoModelDefinition(
  defaultVideoModelId
).defaultDurationSeconds;

export function isVideoDurationSeconds(value: unknown): value is VideoDurationSeconds {
  return isVideoModelDurationSupported(defaultVideoModelId, value);
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
