export type AutomaticCueDecision = "ignore" | "wait-for-remix" | "take-remix";

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
