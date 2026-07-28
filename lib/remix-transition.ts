export type AutomaticCueDecision = "ignore" | "wait-for-remix" | "take-remix";
export type VideoSlotIndex = 0 | 1;

export function decideAutomaticCueTransition({
  autoTakeOnCue,
  nextAssetReady
}: {
  autoTakeOnCue: boolean;
  nextAssetReady: boolean;
}): AutomaticCueDecision {
  if (!autoTakeOnCue) {
    return "ignore";
  }

  return nextAssetReady ? "take-remix" : "wait-for-remix";
}

export function getTypewriterChunkSize(characterCount: number) {
  if (characterCount <= 0) {
    return 0;
  }

  return Math.max(3, Math.ceil(characterCount / 110));
}

export function getAudienceFacingRemixPrompt(rawSubmissionText: string | null | undefined) {
  return rawSubmissionText?.trim() || "New remix incoming.";
}

export function getPlaybackAttribution(asset: {
  promptText?: string | null;
  sourceSubmission?: {
    rawText?: string | null;
    sender?: string | null;
    source?: string | null;
  } | null;
} | null) {
  const sourceSubmission = asset?.sourceSubmission;
  const webNickname =
    sourceSubmission?.source === "web"
      ? sourceSubmission.sender?.trim()
      : null;

  return {
    nickname:
      webNickname ||
      (sourceSubmission ? "CROWD REMIX" : "DREAM SEQUENCE"),
    promptText:
      sourceSubmission?.rawText?.trim() ||
      asset?.promptText?.trim() ||
      "Original session visual"
  };
}

export function shouldAdvancePlaybackAtVideoEnd({
  activeSlotEnded,
  audioSyncConnected,
  nextAssetReady
}: {
  activeSlotEnded: boolean;
  audioSyncConnected: boolean;
  nextAssetReady: boolean;
}) {
  return activeSlotEnded && !audioSyncConnected && nextAssetReady;
}

export function getStandbyVideoSlot(activeSlot: VideoSlotIndex): VideoSlotIndex {
  return activeSlot === 0 ? 1 : 0;
}

export function isVideoSlotVisible({
  slot,
  activeSlot,
  incomingSlot
}: {
  slot: VideoSlotIndex;
  activeSlot: VideoSlotIndex;
  incomingSlot: VideoSlotIndex | null;
}) {
  return slot === activeSlot || slot === incomingSlot;
}
