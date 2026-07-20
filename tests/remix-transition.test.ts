import { describe, expect, it } from "vitest";
import { decideAutomaticCueTransition, getTypewriterChunkSize } from "@/lib/remix-transition";

describe("remix transition cues", () => {
  it("keeps a musical cue pending until the next remix is ready", () => {
    expect(
      decideAutomaticCueTransition({
        autoTakeOnCue: true,
        nextAssetReady: false
      })
    ).toBe("wait-for-remix");

    expect(
      decideAutomaticCueTransition({
        autoTakeOnCue: true,
        nextAssetReady: true
      })
    ).toBe("take-remix");
  });

  it("ignores musical cues when automatic takes are disabled", () => {
    expect(
      decideAutomaticCueTransition({
        autoTakeOnCue: false,
        nextAssetReady: true
      })
    ).toBe("ignore");
  });

  it("reveals prompts in small typewriter chunks", () => {
    expect(getTypewriterChunkSize(80)).toBe(3);
    expect(getTypewriterChunkSize(600)).toBe(6);
  });
});
