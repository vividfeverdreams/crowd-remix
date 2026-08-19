export const showPlaybackModeMessageType =
  "dream-sequence:show-playback-mode" as const;

export type ShowPlaybackModeMessage = {
  type: typeof showPlaybackModeMessageType;
  monitor: boolean;
};

export function createShowPlaybackModeMessage(
  monitor: boolean
): ShowPlaybackModeMessage {
  return {
    type: showPlaybackModeMessageType,
    monitor
  };
}

export function readShowPlaybackModeMessage(data: unknown) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const candidate = data as Partial<ShowPlaybackModeMessage>;

  return candidate.type === showPlaybackModeMessageType &&
    typeof candidate.monitor === "boolean"
    ? candidate.monitor
    : null;
}
