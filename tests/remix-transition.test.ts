import { describe, expect, it } from "vitest";
import {
  decideAutomaticCueTransition,
  getAudienceFacingRemixPrompt,
  getChronologicalPlaybackRotation,
  getIntroducedPlaybackAssetIds,
  getNextPlaybackRotationAsset,
  getPlaybackAttribution,
  getStandbyVideoSlot,
  isVideoSlotVisible,
  shouldAdvancePlaybackAtVideoEnd,
  shouldHandoffPreparedPlaybackAtBoundary,
  shouldShowPlaybackIntroduction,
  shouldStartAutomaticPlaybackTransition,
  getTypewriterChunkSize
} from "@/lib/remix-transition";

describe("remix transition cues", () => {
  const rotationAsset = (
    id: string,
    minute: number,
    kind: "seed" | "remix" = "remix"
  ) => ({
    id,
    kind,
    createdAt: new Date(`2026-07-28T12:${String(minute).padStart(2, "0")}:00.000Z`)
  });

  it("keeps the original through remix four, then rolls the newest five remixes", () => {
    const original = rotationAsset("original", 0, "seed");
    const remixes = Array.from({ length: 6 }, (_, index) =>
      rotationAsset(`remix-${index + 1}`, index + 1)
    );

    expect(
      getChronologicalPlaybackRotation([original, ...remixes.slice(0, 4)]).map(
        (asset) => asset.id
      )
    ).toEqual([
      "original",
      "remix-1",
      "remix-2",
      "remix-3",
      "remix-4"
    ]);
    expect(
      getChronologicalPlaybackRotation([original, ...remixes.slice(0, 5)]).map(
        (asset) => asset.id
      )
    ).toEqual([
      "remix-1",
      "remix-2",
      "remix-3",
      "remix-4",
      "remix-5"
    ]);
    expect(
      getChronologicalPlaybackRotation([original, ...remixes]).map(
        (asset) => asset.id
      )
    ).toEqual([
      "remix-2",
      "remix-3",
      "remix-4",
      "remix-5",
      "remix-6"
    ]);
  });

  it("selects the chronological successor and wraps inside the active window", () => {
    const assets = [
      rotationAsset("original", 0, "seed"),
      ...Array.from({ length: 6 }, (_, index) =>
        rotationAsset(`remix-${index + 1}`, index + 1)
      )
    ];

    expect(getNextPlaybackRotationAsset(assets, "remix-3")?.id).toBe("remix-4");
    expect(getNextPlaybackRotationAsset(assets, "remix-6")?.id).toBe("remix-2");
    expect(getNextPlaybackRotationAsset(assets, "remix-1")?.id).toBe("remix-2");
  });

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

  it("seeds introduced IDs from played assets and the current asset", () => {
    const introducedAssetIds = getIntroducedPlaybackAssetIds(
      [
        {
          id: "asset-ready",
          status: "ready"
        },
        {
          id: "asset-live",
          status: "live"
        },
        {
          id: "asset-archived",
          status: "archived"
        },
        {
          id: "asset-processing",
          status: "processing"
        },
        null
      ],
      "asset-current"
    );

    expect([...introducedAssetIds].sort()).toEqual([
      "asset-archived",
      "asset-current",
      "asset-live"
    ]);
  });

  it("shows a ready asset introduction once and skips played rotation assets", () => {
    const introducedAssetIds = new Set(["asset-seen"]);

    expect(
      shouldShowPlaybackIntroduction(
        {
          id: "asset-new",
          status: "ready"
        },
        introducedAssetIds
      )
    ).toBe(true);

    introducedAssetIds.add("asset-new");

    expect(
      shouldShowPlaybackIntroduction(
        {
          id: "asset-new",
          status: "ready"
        },
        introducedAssetIds
      )
    ).toBe(false);
    expect(
      shouldShowPlaybackIntroduction(
        {
          id: "asset-live",
          status: "live"
        },
        introducedAssetIds
      )
    ).toBe(false);
    expect(
      shouldShowPlaybackIntroduction(
        {
          id: "asset-archived",
          status: "archived"
        },
        introducedAssetIds
      )
    ).toBe(false);
  });

  it.each([
    {
      duration: 4,
      beforeLeadTime: 3.49,
      atLeadTime: 3.5
    },
    {
      duration: 6,
      beforeLeadTime: 5.49,
      atLeadTime: 5.5
    },
    {
      duration: 8,
      beforeLeadTime: 7.49,
      atLeadTime: 7.5
    }
  ])(
    "begins the automatic transition within the final half-second of a $duration-second video",
    ({ duration, beforeLeadTime, atLeadTime }) => {
      const baseInput = {
        isMonitor: false,
        activeSlot: true,
        audioSyncConnected: false,
        nextAssetReady: true,
        transitionInFlight: false,
        duration
      };

      expect(
        shouldStartAutomaticPlaybackTransition({
          ...baseInput,
          currentTime: beforeLeadTime
        })
      ).toBe(false);
      expect(
        shouldStartAutomaticPlaybackTransition({
          ...baseInput,
          currentTime: atLeadTime
        })
      ).toBe(true);
    }
  );

  it("gates automatic near-end transitions on playback state", () => {
    const baseInput = {
      isMonitor: false,
      activeSlot: true,
      audioSyncConnected: false,
      nextAssetReady: true,
      transitionInFlight: false,
      currentTime: 7.75,
      duration: 8
    };

    expect(shouldStartAutomaticPlaybackTransition(baseInput)).toBe(true);
    expect(
      shouldStartAutomaticPlaybackTransition({
        ...baseInput,
        isMonitor: true
      })
    ).toBe(false);
    expect(
      shouldStartAutomaticPlaybackTransition({
        ...baseInput,
        activeSlot: false
      })
    ).toBe(false);
    expect(
      shouldStartAutomaticPlaybackTransition({
        ...baseInput,
        audioSyncConnected: true
      })
    ).toBe(false);
    expect(
      shouldStartAutomaticPlaybackTransition({
        ...baseInput,
        nextAssetReady: false
      })
    ).toBe(false);
    expect(
      shouldStartAutomaticPlaybackTransition({
        ...baseInput,
        transitionInFlight: true
      })
    ).toBe(false);
  });

  it.each([
    {
      currentTime: Number.NaN,
      duration: 8
    },
    {
      currentTime: 7,
      duration: Number.POSITIVE_INFINITY
    },
    {
      currentTime: 0,
      duration: 0
    },
    {
      currentTime: -0.1,
      duration: 8
    },
    {
      currentTime: 8.1,
      duration: 8
    }
  ])(
    "rejects invalid media timing %#",
    ({ currentTime, duration }) => {
      expect(
        shouldStartAutomaticPlaybackTransition({
          isMonitor: false,
          activeSlot: true,
          audioSyncConnected: false,
          nextAssetReady: true,
          transitionInFlight: false,
          currentTime,
          duration
        })
      ).toBe(false);
    }
  );

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

  it("keeps audio-synced handoffs at boundaries while requiring cue authorization", () => {
    expect(
      shouldHandoffPreparedPlaybackAtBoundary({
        isMonitor: false,
        audioSyncConnected: false,
        candidateAssetId: "remix-2",
        authorizedAssetId: null
      })
    ).toBe(true);
    expect(
      shouldHandoffPreparedPlaybackAtBoundary({
        isMonitor: false,
        audioSyncConnected: true,
        candidateAssetId: "remix-2",
        authorizedAssetId: null
      })
    ).toBe(false);
    expect(
      shouldHandoffPreparedPlaybackAtBoundary({
        isMonitor: false,
        audioSyncConnected: true,
        candidateAssetId: "remix-2",
        authorizedAssetId: "remix-2"
      })
    ).toBe(true);
  });

  it("allows a read-only monitor to follow only its authoritative candidate", () => {
    expect(
      shouldHandoffPreparedPlaybackAtBoundary({
        isMonitor: true,
        audioSyncConnected: true,
        candidateAssetId: "server-current",
        authorizedAssetId: null
      })
    ).toBe(true);
    expect(
      shouldHandoffPreparedPlaybackAtBoundary({
        isMonitor: true,
        audioSyncConnected: false,
        candidateAssetId: null,
        authorizedAssetId: null
      })
    ).toBe(false);
  });
});
