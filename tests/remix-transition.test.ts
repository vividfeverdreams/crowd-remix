import { describe, expect, it } from "vitest";
import {
  decideAutomaticCueTransition,
  getAudienceFacingRemixPrompt,
  getPlaybackAttribution,
  getStandbyVideoSlot,
  isVideoSlotVisible,
  shouldAdvancePlaybackAtVideoEnd,
  getTypewriterChunkSize
} from "@/lib/remix-transition";

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

  it("uses only the audience submission for the show overlay", () => {
    expect(getAudienceFacingRemixPrompt("  Make it on fire  ")).toBe("Make it on fire");
    expect(getAudienceFacingRemixPrompt(null)).toBe("New remix incoming.");
  });

  it("attributes a web remix to its nickname and original prompt", () => {
    expect(
      getPlaybackAttribution({
        promptText: "Private generation prompt",
        sourceSubmission: {
          rawText: "  Turn the skyline into liquid chrome  ",
          sender: "  NeonGhost  ",
          source: "web"
        }
      })
    ).toEqual({
      nickname: "NeonGhost",
      promptText: "Turn the skyline into liquid chrome"
    });
  });

  it("redacts an SMS sender from playback attribution", () => {
    expect(
      getPlaybackAttribution({
        promptText: "Private generation prompt",
        sourceSubmission: {
          rawText: "Add violet lightning",
          sender: "+13125550123",
          source: "sms"
        }
      })
    ).toEqual({
      nickname: "CROWD REMIX",
      promptText: "Add violet lightning"
    });
  });

  it("labels a seed with DREAM SEQUENCE and its asset prompt", () => {
    expect(
      getPlaybackAttribution({
        promptText: "  A slow orbit through a paper galaxy  ",
        sourceSubmission: null
      })
    ).toEqual({
      nickname: "DREAM SEQUENCE",
      promptText: "A slow orbit through a paper galaxy"
    });
  });

  it("falls back safely when attribution fields contain only whitespace", () => {
    expect(
      getPlaybackAttribution({
        promptText: "   ",
        sourceSubmission: {
          rawText: "\n\t",
          sender: "   ",
          source: "web"
        }
      })
    ).toEqual({
      nickname: "CROWD REMIX",
      promptText: "Original session visual"
    });
  });

  it("keeps a decoded video slot visible across the logical handoff", () => {
    const incomingSlot = getStandbyVideoSlot(0);

    expect(incomingSlot).toBe(1);
    expect(
      [0, 1].map((slot) =>
        isVideoSlotVisible({
          slot: slot as 0 | 1,
          activeSlot: 0,
          incomingSlot
        })
      )
    ).toEqual([true, true]);
    expect(
      [0, 1].map((slot) =>
        isVideoSlotVisible({
          slot: slot as 0 | 1,
          activeSlot: incomingSlot,
          incomingSlot: null
        })
      )
    ).toEqual([false, true]);
  });

  it("advances the rotation only when the active video ends with a next clip ready", () => {
    expect(
      shouldAdvancePlaybackAtVideoEnd({
        activeSlotEnded: true,
        audioSyncConnected: false,
        nextAssetReady: true
      })
    ).toBe(true);
    expect(
      shouldAdvancePlaybackAtVideoEnd({
        activeSlotEnded: false,
        audioSyncConnected: false,
        nextAssetReady: true
      })
    ).toBe(false);
    expect(
      shouldAdvancePlaybackAtVideoEnd({
        activeSlotEnded: true,
        audioSyncConnected: true,
        nextAssetReady: true
      })
    ).toBe(false);
    expect(
      shouldAdvancePlaybackAtVideoEnd({
        activeSlotEnded: true,
        audioSyncConnected: false,
        nextAssetReady: false
      })
    ).toBe(false);
  });
});
