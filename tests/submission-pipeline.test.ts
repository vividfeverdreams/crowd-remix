import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const values = {
    findJobs: vi.fn(),
    findSession: vi.fn(),
    findSubmission: vi.fn(),
    findGenerationHead: vi.fn(),
    claimSession: vi.fn(),
    createAsset: vi.fn(),
    createJob: vi.fn(),
    updateJob: vi.fn(),
    updateAsset: vi.fn(),
    updateManyJobs: vi.fn(),
    claimSubmission: vi.fn(),
    promoteOldestReadyAsset: vi.fn(),
    takePlaybackAsset: vi.fn(),
    reconcileRenderJob: vi.fn(),
    completeGeminiVideoRender: vi.fn(),
    failRenderJob: vi.fn(),
    startVideoRender: vi.fn(),
    directVideoPrompt: vi.fn()
  };
  const transactionClient = {
    dJSession: {
      findUnique: values.findSession,
      updateMany: values.claimSession
    },
    promptSubmission: {
      findUnique: values.findSubmission,
      updateMany: values.claimSubmission
    },
    renderJob: {
      create: values.createJob,
      findFirst: values.findGenerationHead,
      update: values.updateJob
    },
    visualAsset: {
      create: values.createAsset,
      update: values.updateAsset
    }
  };

  return {
    ...values,
    runTransaction: vi.fn(
      async (callback: (tx: typeof transactionClient) => unknown) =>
        callback(transactionClient)
    )
  };
});

vi.mock("@/lib/db", () => ({
  db: {
    dJSession: {
      findUnique: mocks.findSession
    },
    promptSubmission: {
      findUnique: mocks.findSubmission
    },
    renderJob: {
      create: mocks.createJob,
      findMany: mocks.findJobs,
      update: mocks.updateJob,
      updateMany: mocks.updateManyJobs
    },
    visualAsset: {
      create: mocks.createAsset
    },
    $transaction: mocks.runTransaction
  }
}));

vi.mock("@/lib/rendering", () => ({
  completeGeminiVideoRender: mocks.completeGeminiVideoRender,
  failRenderJob: mocks.failRenderJob,
  formatVideoModerationFailureReason: (message: string) => message,
  isVideoModerationError: vi.fn().mockReturnValue(false),
  reconcileRenderJob: mocks.reconcileRenderJob,
  startVideoRender: mocks.startVideoRender
}));

vi.mock("@/lib/playback-queue", () => ({
  promoteOldestReadyAsset: mocks.promoteOldestReadyAsset
}));

vi.mock("@/lib/playback-transition", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/playback-transition")>();

  return {
    ...actual,
    takePlaybackAsset: mocks.takePlaybackAsset
  };
});

vi.mock("@/lib/google-key-store", () => ({
  getEffectiveGeminiApiKeyForUser: vi.fn().mockResolvedValue("test-api-key")
}));

vi.mock("@/lib/audit", () => ({
  recordAuditEvent: vi.fn()
}));

vi.mock("@/lib/video-prompt-director", () => ({
  directVideoPrompt: mocks.directVideoPrompt
}));

import {
  attemptAutomatedSelection,
  queueAutomatedRender,
  reconcilePendingRenderJobs
} from "@/lib/submission-pipeline";
import {
  readyPlaybackStallMs,
  shouldRecoverReadyPlaybackAsset
} from "@/lib/playback-transition";
import {
  providerArtistCameraPriorityRequirement,
  providerCameraContinuityRequirement,
  providerCrowdReferenceRequirement,
  providerOpeningFrameContinuityRequirement,
  providerSeamlessLoopRequirement,
  providerVenueSafetyRequirement
} from "@/lib/video-prompt-budget";

describe("ready playback recovery", () => {
  it("preserves a freshly staged next asset for the show introduction", () => {
    const now = Date.parse("2026-08-18T20:00:00.000Z");

    expect(
      shouldRecoverReadyPlaybackAsset({
        readyAssetId: "asset-next",
        nextAssetId: "asset-next",
        readyAssetUpdatedAt: new Date(now - readyPlaybackStallMs + 1),
        now
      })
    ).toBe(false);
  });

  it("recovers a staged asset only after the show has had time to introduce it", () => {
    const now = Date.parse("2026-08-18T20:00:00.000Z");

    expect(
      shouldRecoverReadyPlaybackAsset({
        readyAssetId: "asset-next",
        nextAssetId: "asset-next",
        readyAssetUpdatedAt: new Date(now - readyPlaybackStallMs),
        now
      })
    ).toBe(true);
  });

  it("immediately recovers an orphan ready asset", () => {
    expect(
      shouldRecoverReadyPlaybackAsset({
        readyAssetId: "asset-orphan",
        nextAssetId: null,
        readyAssetUpdatedAt: new Date(),
        now: Date.now()
      })
    ).toBe(true);
  });
});

describe("submission render queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.promoteOldestReadyAsset.mockResolvedValue(null);
    mocks.takePlaybackAsset.mockResolvedValue(true);
    mocks.updateManyJobs.mockResolvedValue({
      count: 1
    });
    mocks.claimSession.mockResolvedValue({
      count: 1
    });
    mocks.claimSubmission.mockResolvedValue({
      count: 1
    });
    mocks.updateJob.mockResolvedValue({});
    mocks.updateAsset.mockResolvedValue({});
    mocks.directVideoPrompt.mockImplementation(async (input) => ({
      prompt: input.assessedPrompt,
      sourceAnalyzed: false,
      fallbackReason: "test_fallback"
    }));
    mocks.findGenerationHead.mockResolvedValue({
      outputAsset: {
        id: "asset-current",
        promptText: "Current source prompt",
        sourceVideoId: "file_current",
        publicUrl: "https://example.com/current.mp4",
        status: "live"
      }
    });
  });

  it("selects the next approved prompt after a render frees the slot", async () => {
    mocks.findJobs.mockResolvedValue([
      {
        id: "render-current",
        status: "in_progress"
      }
    ]);
    mocks.reconcileRenderJob.mockResolvedValue({
      status: "completed",
      progress: 100
    });
    mocks.findSession
      .mockResolvedValueOnce({
        id: "session-1",
        userId: "user-1",
        autoSelectEnabled: true,
        playbackState: {
          currentAssetId: "asset-current",
          nextAssetId: "asset-ready",
          lastTransitionAt: new Date(0),
          emergencyPaused: false
        },
        renderJobs: [],
        visualAssets: [],
        submissions: [
          {
            id: "submission-next",
            rankingResult: {
              score: 92,
              winningPrompt: "Compiled private model prompt"
            }
          }
        ]
      })
      .mockResolvedValueOnce({
        id: "session-1",
        userId: "user-1",
        imageReferenceUrl: null,
        videoModel: "seedance2",
        videoDurationSeconds: 6,
        playbackState: {
          currentAssetId: "asset-current",
          nextAssetId: null
        },
        renderJobs: [],
        visualAssets: []
      });
    mocks.createAsset.mockResolvedValue({ id: "asset-next" });
    mocks.createJob.mockResolvedValue({ id: "render-next" });
    mocks.findSubmission.mockResolvedValue({
      referenceImageUrl: "https://example.com/reference.jpg"
    });
    mocks.startVideoRender.mockResolvedValue({
      kind: "live",
      requestId: "request-next",
      outputUri: "https://example.com/generated.mp4",
      strategy: "stateful_edit"
    });
    mocks.updateJob.mockResolvedValue({});

    const updates = await reconcilePendingRenderJobs("session-1");

    expect(updates).toEqual([
      {
        id: "render-current",
        status: "completed",
        progress: 100
      }
    ]);
    expect(mocks.claimSubmission).toHaveBeenCalledWith({
      where: {
        id: "submission-next",
        sessionId: "session-1",
        status: "approved",
        selectedAt: null
      },
      data: {
        status: "queued",
        selectedAt: expect.any(Date)
      }
    });
    expect(mocks.createAsset).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourceSubmissionId: "submission-next",
        promptText: "Compiled private model prompt",
        durationSeconds: 6
      })
    });
    expect(mocks.startVideoRender).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "remix",
        prompt: expect.stringContaining("Compiled private model prompt"),
        remixReferenceImageUrl: "https://example.com/reference.jpg",
        videoModel: "seedance2",
        durationSeconds: 6
      })
    );
    expect(mocks.completeGeminiVideoRender).toHaveBeenCalledWith(
      "request-next",
      "https://example.com/generated.mp4"
    );
  });

  it("renders an approved prompt while an archived rotation clip occupies the next slot", async () => {
    mocks.findSession
      .mockResolvedValueOnce({
        id: "session-1",
        userId: "user-1",
        autoSelectEnabled: true,
        playbackState: {
          currentAssetId: "asset-current",
          nextAssetId: "asset-archived-next",
          emergencyPaused: false
        },
        renderJobs: [],
        visualAssets: [],
        submissions: [
          {
            id: "submission-next",
            rankingResult: {
              score: 92,
              winningPrompt: "A fresh audience remix"
            }
          }
        ]
      })
      .mockResolvedValueOnce({
        id: "session-1",
        userId: "user-1",
        imageReferenceUrl: null,
        videoDurationSeconds: 8,
        playbackState: {
          currentAssetId: "asset-current",
          nextAssetId: "asset-archived-next"
        },
        renderJobs: [],
        visualAssets: []
      });
    mocks.createAsset.mockResolvedValue({ id: "asset-new" });
    mocks.createJob.mockResolvedValue({ id: "render-new" });
    mocks.findSubmission.mockResolvedValue({
      referenceImageUrl: null
    });
    mocks.startVideoRender.mockResolvedValue({
      kind: "live",
      requestId: "request-new",
      outputUri: null,
      strategy: "stateful_edit"
    });
    mocks.updateJob.mockResolvedValue({});

    await expect(attemptAutomatedSelection("session-1")).resolves.toEqual({
      id: "render-new"
    });

    expect(mocks.claimSubmission).toHaveBeenCalledWith({
      where: {
        id: "submission-next",
        sessionId: "session-1",
        status: "approved",
        selectedAt: null
      },
      data: {
        status: "queued",
        selectedAt: expect.any(Date)
      }
    });
    expect(mocks.createAsset).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourceSubmissionId: "submission-next",
        promptText: "A fresh audience remix",
        status: "processing"
      })
    });
    expect(mocks.startVideoRender).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "remix",
        prompt: expect.stringContaining("A fresh audience remix"),
        sourceVideoId: "file_current"
      })
    );
  });

  it("remixes the newest generated asset even while an older rotation clip is live", async () => {
    mocks.findGenerationHead.mockResolvedValue({
      outputAsset: {
        id: "asset-remix-2",
        sourceVideoId: "v1_remix-2",
        publicUrl: "https://example.com/remix-2.mp4",
        status: "archived"
      }
    });
    mocks.findSession
      .mockResolvedValueOnce({
        id: "session-1",
        userId: "user-1",
        autoSelectEnabled: true,
        playbackState: {
          currentAssetId: "asset-original",
          nextAssetId: "asset-remix-1",
          emergencyPaused: false
        },
        renderJobs: [],
        visualAssets: [],
        submissions: [
          {
            id: "submission-remix-3",
            rankingResult: {
              score: 99,
              winningPrompt: "Turn the latest remix into a glass forest"
            }
          }
        ]
      })
      .mockResolvedValueOnce({
        id: "session-1",
        userId: "user-1",
        imageReferenceUrl: null,
        videoDurationSeconds: 4,
        playbackState: {
          currentAssetId: "asset-original",
          nextAssetId: "asset-remix-1"
        },
        renderJobs: [],
        visualAssets: []
      });
    mocks.createAsset.mockResolvedValue({ id: "asset-remix-3" });
    mocks.createJob.mockResolvedValue({ id: "render-remix-3" });
    mocks.findSubmission.mockResolvedValue({
      referenceImageUrl: null
    });
    mocks.startVideoRender.mockResolvedValue({
      kind: "live",
      requestId: "v1_remix-3",
      outputUri: null,
      strategy: "stateful_edit"
    });

    await attemptAutomatedSelection("session-1");

    expect(mocks.findGenerationHead).toHaveBeenCalledWith({
      where: {
        sessionId: "session-1",
        status: "completed"
      },
      orderBy: [
        {
          createdAt: "desc"
        },
        {
          id: "desc"
        }
      ],
      select: {
        outputAsset: {
          select: {
            id: true,
            promptText: true,
            publicUrl: true,
            thumbnailUrl: true,
            sourceVideoId: true,
            status: true
          }
        }
      }
    });
    expect(mocks.createJob).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourceAssetId: "asset-remix-2",
        outputAssetId: "asset-remix-3"
      })
    });
    expect(mocks.startVideoRender).toHaveBeenCalledWith(
      expect.objectContaining({
        durationSeconds: 4,
        mode: "remix",
        sourceVideoId: "v1_remix-2",
        sourceVideoUrl: "https://example.com/remix-2.mp4"
      })
    );
  });

  it("budgets a 900-character directed prompt and persists exactly what it dispatches", async () => {
    const directedPrompt =
      `Keep the crowd-requested locked static camera. ${"D".repeat(900)}`.slice(
        0,
        900
      );
    mocks.findGenerationHead.mockResolvedValue({
      outputAsset: {
        id: "asset-remix-2",
        promptText: "Current chrome canyon prompt",
        sourceVideoId: "v1_remix-2",
        publicUrl: "https://example.com/remix-2.mp4",
        thumbnailUrl: "https://example.com/remix-2-closing-frame.jpg",
        status: "archived"
      }
    });
    mocks.findSession.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      updatedAt: new Date("2026-08-19T10:00:00.000Z"),
      artistName: "Neon Echo",
      trackName: "Skyline Pressure",
      creativeBible: "Reflective dream architecture",
      allowedMotifs: "prisms",
      bannedTerms: "logos",
      colorPalette: "cobalt and ember",
      motionRules: "fast clockwise orbit despite conflicting crowd camera direction",
      artistControlEnabled: true,
      venueSafeMode: true,
      basePrompt: "An endless mirrored desert",
      imageReferenceUrl: null,
      videoModel: "seedance2",
      videoDurationSeconds: 8,
      playbackState: {
        currentAssetId: "asset-older-live",
        nextAssetId: null,
        currentAsset: null
      },
      renderJobs: [],
      visualAssets: []
    });
    mocks.findSubmission.mockResolvedValue({
      rawText: "Make it bloom into paper planets",
      referenceImageUrl: "https://example.com/crowd-photo.jpg"
    });
    mocks.createAsset.mockResolvedValue({ id: "asset-remix-3" });
    mocks.createJob.mockResolvedValue({ id: "render-remix-3" });
    mocks.directVideoPrompt.mockResolvedValue({
      prompt: directedPrompt,
      sourceAnalyzed: true,
      fallbackReason: null
    });
    mocks.startVideoRender.mockResolvedValue({
      kind: "live",
      requestId: "seedance-request-3",
      outputUri: null,
      strategy: "runway_video_to_video"
    });

    await queueAutomatedRender(
      "session-1",
      "submission-3",
      "remix",
      "Assessed paper-planet transformation"
    );

    expect(mocks.directVideoPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "test-api-key",
        sourceAssetId: "asset-remix-2",
        sourceVideoUrl: "https://example.com/remix-2.mp4",
        originalPrompt: "An endless mirrored desert",
        currentPrompt: "Current chrome canyon prompt",
        incomingPrompt: "Make it bloom into paper planets",
        assessedPrompt: "Assessed paper-planet transformation",
        videoModel: "seedance2"
      })
    );
    const finalProviderPrompt = (
      mocks.startVideoRender.mock.calls[0]?.[0] as { prompt: string }
    ).prompt;

    expect(directedPrompt).toHaveLength(900);
    expect(
      finalProviderPrompt.startsWith(
        providerOpeningFrameContinuityRequirement
      )
    ).toBe(true);
    expect(finalProviderPrompt).toContain(providerCrowdReferenceRequirement);
    expect(finalProviderPrompt).toContain("crowd-requested locked static camera");
    expect(finalProviderPrompt).toContain(
      "fast clockwise orbit despite conflicting crowd camera direction"
    );
    expect(finalProviderPrompt).toContain(
      providerArtistCameraPriorityRequirement
    );
    expect(finalProviderPrompt).toContain(providerSeamlessLoopRequirement);
    expect(finalProviderPrompt).toContain(providerVenueSafetyRequirement);
    expect(finalProviderPrompt.length).toBeLessThanOrEqual(1_000);
    expect(mocks.updateJob).toHaveBeenCalledWith({
      where: {
        id: "render-remix-3"
      },
      data: {
        promptText: finalProviderPrompt
      }
    });
    expect(mocks.updateAsset).toHaveBeenCalledWith({
      where: {
        id: "asset-remix-3"
      },
      data: {
        promptText: finalProviderPrompt
      }
    });
    expect(mocks.startVideoRender).toHaveBeenCalledWith(
      expect.objectContaining({
        openingFrameImageUrl:
          "https://example.com/remix-2-closing-frame.jpg",
        remixReferenceImageUrl: "https://example.com/crowd-photo.jpg",
        prompt: finalProviderPrompt
      })
    );
  });

  it("adds artist camera rules to a long seed without imposing a venue clause when disabled", async () => {
    const motionRules =
      "Locked-off static camera for the whole clip; pulse only the prism lighting";
    mocks.findSession.mockResolvedValue({
      id: "session-seed",
      userId: "user-1",
      updatedAt: new Date("2026-08-19T11:00:00.000Z"),
      motionRules,
      artistControlEnabled: false,
      venueSafeMode: false,
      imageReferenceUrl: null,
      videoModel: "seedance2",
      videoDurationSeconds: 8,
      playbackState: {
        currentAssetId: null,
        nextAssetId: null,
        currentAsset: null
      },
      renderJobs: [],
      visualAssets: []
    });
    mocks.createAsset.mockResolvedValue({ id: "asset-seed" });
    mocks.createJob.mockResolvedValue({ id: "render-seed" });
    mocks.startVideoRender.mockResolvedValue({
      kind: "live",
      requestId: "seed-request",
      outputUri: null,
      strategy: "runway_text_to_video"
    });

    await queueAutomatedRender(
      "session-seed",
      null,
      "seed",
      "A prismatic city made from liquid mirrors. ".repeat(40)
    );

    const finalProviderPrompt = (
      mocks.startVideoRender.mock.calls[0]?.[0] as { prompt: string }
    ).prompt;

    expect(mocks.directVideoPrompt).not.toHaveBeenCalled();
    expect(mocks.findGenerationHead).not.toHaveBeenCalled();
    expect(mocks.findSubmission).not.toHaveBeenCalled();
    expect(mocks.claimSubmission).not.toHaveBeenCalled();
    expect(finalProviderPrompt).toContain(motionRules);
    expect(finalProviderPrompt).toContain(providerSeamlessLoopRequirement);
    expect(finalProviderPrompt).toContain("leave it unrestricted");
    expect(finalProviderPrompt).not.toContain(providerVenueSafetyRequirement);
    expect(finalProviderPrompt.length).toBeLessThanOrEqual(1_000);
    expect(mocks.updateJob).toHaveBeenCalledWith({
      where: { id: "render-seed" },
      data: { promptText: finalProviderPrompt }
    });
    expect(mocks.updateAsset).toHaveBeenCalledWith({
      where: { id: "asset-seed" },
      data: { promptText: finalProviderPrompt }
    });
  });

  it("keeps artist motion rules for a manual fallback even when artist control is off", async () => {
    const motionRules = "Rapid crane rises with a snap zoom on every downbeat";
    mocks.findGenerationHead.mockResolvedValue({
      outputAsset: {
        id: "asset-live",
        promptText: "Current source prompt",
        sourceVideoId: "v1_live",
        publicUrl: "https://example.com/live.mp4",
        status: "live"
      }
    });
    mocks.findSession.mockResolvedValue({
      id: "session-manual",
      userId: "user-1",
      updatedAt: new Date("2026-08-19T11:10:00.000Z"),
      artistName: "Neon Echo",
      trackName: "Skyline Pressure",
      creativeBible: "Reflective dream architecture",
      allowedMotifs: "prisms",
      bannedTerms: "logos",
      colorPalette: "cobalt and ember",
      motionRules,
      basePrompt: "An endless mirrored desert",
      artistControlEnabled: false,
      venueSafeMode: true,
      imageReferenceUrl: null,
      videoModel: "seedance2",
      videoDurationSeconds: 8,
      playbackState: {
        currentAssetId: "asset-live",
        nextAssetId: null,
        currentAsset: null
      },
      renderJobs: [],
      visualAssets: []
    });
    mocks.createAsset.mockResolvedValue({ id: "asset-manual" });
    mocks.createJob.mockResolvedValue({ id: "render-manual" });
    mocks.startVideoRender.mockResolvedValue({
      kind: "live",
      requestId: "manual-request",
      outputUri: null,
      strategy: "runway_video_to_video"
    });

    await queueAutomatedRender(
      "session-manual",
      null,
      "remix",
      "Shift the active loop into an ember prism cathedral"
    );

    const finalProviderPrompt = (
      mocks.startVideoRender.mock.calls[0]?.[0] as { prompt: string }
    ).prompt;

    expect(mocks.findSubmission).not.toHaveBeenCalled();
    expect(mocks.claimSubmission).not.toHaveBeenCalled();
    expect(mocks.directVideoPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        incomingPrompt: "Shift the active loop into an ember prism cathedral"
      })
    );
    expect(finalProviderPrompt).toContain(motionRules);
    expect(finalProviderPrompt).toContain(
      providerArtistCameraPriorityRequirement
    );
    expect(finalProviderPrompt).toContain(providerVenueSafetyRequirement);
    expect(finalProviderPrompt.length).toBeLessThanOrEqual(1_000);
  });

  it("omits session motion rules for a raw audience remix while preserving audience camera direction", async () => {
    const artistRuleSentinel = "ARTIST_LOCKED_CAMERA_SENTINEL";
    mocks.findGenerationHead.mockResolvedValue({
      outputAsset: {
        id: "asset-raw-source",
        promptText: "Current source prompt",
        sourceVideoId: "v1_raw_source",
        publicUrl: "https://example.com/raw-source.mp4",
        status: "live"
      }
    });
    mocks.findSession.mockResolvedValue({
      id: "session-raw",
      userId: "user-1",
      updatedAt: new Date("2026-08-19T11:20:00.000Z"),
      artistName: "Neon Echo",
      trackName: "Skyline Pressure",
      creativeBible: "Reflective dream architecture",
      allowedMotifs: "prisms",
      bannedTerms: "logos",
      colorPalette: "cobalt and ember",
      motionRules: artistRuleSentinel,
      basePrompt: "An endless mirrored desert",
      artistControlEnabled: false,
      venueSafeMode: false,
      imageReferenceUrl: null,
      videoModel: "seedance2",
      videoDurationSeconds: 8,
      playbackState: {
        currentAssetId: "asset-raw-source",
        nextAssetId: null,
        currentAsset: null
      },
      renderJobs: [],
      visualAssets: []
    });
    mocks.findSubmission.mockResolvedValue({
      rawText: "Use a fast clockwise audience-requested orbit",
      referenceImageUrl: null
    });
    mocks.createAsset.mockResolvedValue({ id: "asset-raw" });
    mocks.createJob.mockResolvedValue({ id: "render-raw" });
    mocks.directVideoPrompt.mockResolvedValue({
      prompt: "Use a fast clockwise audience-requested orbit through the chrome canyon",
      sourceAnalyzed: true,
      fallbackReason: null
    });
    mocks.startVideoRender.mockResolvedValue({
      kind: "live",
      requestId: "raw-request",
      outputUri: null,
      strategy: "runway_video_to_video"
    });

    await queueAutomatedRender(
      "session-raw",
      "submission-raw",
      "remix",
      "Use a fast clockwise audience-requested orbit"
    );

    const finalProviderPrompt = (
      mocks.startVideoRender.mock.calls[0]?.[0] as { prompt: string }
    ).prompt;

    expect(finalProviderPrompt).toContain("fast clockwise audience-requested orbit");
    expect(finalProviderPrompt).not.toContain(artistRuleSentinel);
    expect(finalProviderPrompt).not.toContain("Enabled artist motion/camera rules");
    expect(finalProviderPrompt).toContain(providerCameraContinuityRequirement);
    expect(finalProviderPrompt).toContain(providerSeamlessLoopRequirement);
    expect(finalProviderPrompt).not.toContain(providerVenueSafetyRequirement);
    expect(finalProviderPrompt.length).toBeLessThanOrEqual(1_000);
    expect(mocks.updateJob).toHaveBeenCalledWith({
      where: { id: "render-raw" },
      data: { promptText: finalProviderPrompt }
    });
    expect(mocks.updateAsset).toHaveBeenCalledWith({
      where: { id: "asset-raw" },
      data: { promptText: finalProviderPrompt }
    });
  });

  it("fails closed when final prompt persistence transiently fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.findGenerationHead.mockResolvedValue({
      outputAsset: {
        id: "asset-remix-2",
        promptText: "Current source prompt",
        sourceVideoId: "v1_remix-2",
        publicUrl: "https://example.com/remix-2.mp4",
        status: "live"
      }
    });
    mocks.findSession.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      updatedAt: new Date("2026-08-19T10:00:00.000Z"),
      artistName: "Neon Echo",
      trackName: "Skyline Pressure",
      creativeBible: "Reflective dream architecture",
      allowedMotifs: "prisms",
      bannedTerms: "logos",
      colorPalette: "cobalt and ember",
      motionRules: "clockwise orbit",
      basePrompt: "An endless mirrored desert",
      imageReferenceUrl: null,
      videoModel: "seedance2",
      videoDurationSeconds: 8,
      playbackState: {
        currentAssetId: "asset-remix-2",
        nextAssetId: null,
        currentAsset: null
      },
      renderJobs: [],
      visualAssets: []
    });
    mocks.createAsset.mockResolvedValue({ id: "asset-remix-3" });
    mocks.createJob.mockResolvedValue({ id: "render-remix-3" });
    mocks.directVideoPrompt.mockResolvedValue({
      prompt: "Analyzed continuation through the chrome canyon",
      sourceAnalyzed: true,
      fallbackReason: null
    });
    mocks.updateJob.mockRejectedValueOnce(new Error("transient database error"));
    mocks.startVideoRender.mockResolvedValue({
      kind: "live",
      requestId: "seedance-request-3",
      outputUri: null,
      strategy: "runway_video_to_video"
    });

    await expect(
      queueAutomatedRender(
        "session-1",
        null,
        "remix",
        "Approved fallback prompt"
      )
    ).resolves.toBeNull();

    expect(mocks.startVideoRender).not.toHaveBeenCalled();
    expect(mocks.failRenderJob).toHaveBeenCalledWith(
      "render-remix-3",
      "The final provider prompt could not be persisted."
    );
    expect(warn).toHaveBeenCalledWith(
      "[provider-prompt] could not persist final prompt",
      expect.objectContaining({
        renderJobId: "render-remix-3"
      })
    );
    warn.mockRestore();
  });

  it("never revives a render that became terminal before Gemini returned", async () => {
    mocks.findGenerationHead.mockResolvedValue({
      outputAsset: {
        id: "asset-remix-1",
        sourceVideoId: "v1_remix-1",
        publicUrl: "https://example.com/remix-1.mp4",
        status: "live"
      }
    });
    mocks.findSession.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      imageReferenceUrl: null,
      videoDurationSeconds: 8,
      playbackState: {
        currentAssetId: "asset-remix-1",
        nextAssetId: null
      },
      renderJobs: [],
      visualAssets: []
    });
    mocks.createAsset.mockResolvedValue({
      id: "asset-remix-2"
    });
    mocks.createJob.mockResolvedValue({
      id: "render-remix-2"
    });
    mocks.startVideoRender.mockResolvedValue({
      kind: "live",
      requestId: "v1_remix-2",
      outputUri: "https://example.com/remix-2.mp4",
      strategy: "stateful_edit"
    });
    mocks.updateManyJobs.mockResolvedValue({
      count: 0
    });

    await expect(
      queueAutomatedRender(
        "session-1",
        null,
        "remix",
        "Make the latest remix glow"
      )
    ).resolves.toBeNull();

    expect(mocks.updateManyJobs).toHaveBeenCalledWith({
      where: {
        id: "render-remix-2",
        status: "queued",
        providerRequestId: null
      },
      data: {
        providerRequestId: "v1_remix-2",
        providerOutputUri: "https://example.com/remix-2.mp4",
        providerStrategy: "stateful_edit",
        status: "queued",
        failureReason: null
      }
    });
    expect(mocks.completeGeminiVideoRender).not.toHaveBeenCalled();
    expect(mocks.startVideoRender).toHaveBeenCalledWith(
      expect.objectContaining({
        videoModel: "gemini_omni_flash"
      })
    );
  });

  it("normalizes a stored duration against the selected video model", async () => {
    mocks.findSession.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      updatedAt: new Date("2026-08-14T12:00:00.000Z"),
      imageReferenceUrl: null,
      videoModel: "hailuo3",
      videoDurationSeconds: 4,
      playbackState: {
        currentAssetId: null,
        nextAssetId: null,
        currentAsset: null
      },
      renderJobs: [],
      visualAssets: []
    });
    mocks.createAsset.mockResolvedValue({
      id: "asset-hailuo-seed"
    });
    mocks.createJob.mockResolvedValue({
      id: "render-hailuo-seed"
    });
    mocks.startVideoRender.mockResolvedValue({
      kind: "live",
      requestId: "hailuo-request",
      outputUri: null,
      strategy: "text_to_video"
    });

    await expect(
      queueAutomatedRender(
        "session-1",
        null,
        "seed",
        "Shape an iridescent Hailuo seed"
      )
    ).resolves.toEqual({
      id: "render-hailuo-seed"
    });

    expect(mocks.createAsset).toHaveBeenCalledWith({
      data: expect.objectContaining({
        durationSeconds: 8
      })
    });
    expect(mocks.startVideoRender).toHaveBeenCalledWith(
      expect.objectContaining({
        videoModel: "hailuo3",
        durationSeconds: 8
      })
    );
  });

  it("allows only one concurrent render to claim the generation head", async () => {
    const updatedAt = new Date("2026-07-29T04:00:00.000Z");
    mocks.findSession.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      updatedAt,
      imageReferenceUrl: null,
      videoDurationSeconds: 8,
      playbackState: {
        currentAssetId: "asset-remix-1",
        nextAssetId: null,
        currentAsset: null
      },
      renderJobs: [],
      visualAssets: []
    });
    mocks.findGenerationHead.mockResolvedValue({
      outputAsset: {
        id: "asset-remix-1",
        sourceVideoId: "v1_remix-1",
        publicUrl: "https://example.com/remix-1.mp4",
        status: "live"
      }
    });
    mocks.claimSession
      .mockResolvedValueOnce({
        count: 1
      })
      .mockResolvedValueOnce({
        count: 0
      });
    mocks.createAsset.mockResolvedValue({
      id: "asset-remix-2"
    });
    mocks.createJob.mockResolvedValue({
      id: "render-remix-2"
    });
    mocks.startVideoRender.mockResolvedValue({
      kind: "live",
      requestId: "v1_remix-2",
      outputUri: null,
      strategy: "stateful_edit"
    });

    const results = await Promise.all([
      queueAutomatedRender(
        "session-1",
        null,
        "remix",
        "Make the latest remix glow"
      ),
      queueAutomatedRender(
        "session-1",
        null,
        "remix",
        "Make the latest remix crystalline"
      )
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(mocks.claimSession).toHaveBeenCalledTimes(2);
    expect(mocks.createAsset).toHaveBeenCalledTimes(1);
    expect(mocks.createJob).toHaveBeenCalledTimes(1);
    expect(mocks.startVideoRender).toHaveBeenCalledTimes(1);
    expect(
      (mocks.claimSession.mock.calls[0]?.[0] as {
        data: {
          updatedAt: Date;
        };
      }).data.updatedAt.getTime()
    ).toBeGreaterThan(updatedAt.getTime());
  });

  it("fails closed instead of skipping an unusable newest completed remix", async () => {
    mocks.findSession.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      updatedAt: new Date("2026-07-29T04:00:00.000Z"),
      imageReferenceUrl: null,
      videoDurationSeconds: 8,
      playbackState: {
        currentAssetId: "asset-older-live",
        nextAssetId: null,
        currentAsset: {
          id: "asset-older-live",
          publicUrl: "https://example.com/older-live.mp4",
          sourceVideoId: "v1_older-live"
        }
      },
      renderJobs: [],
      visualAssets: []
    });
    mocks.findGenerationHead.mockResolvedValue({
      outputAsset: {
        id: "asset-newest-unusable",
        sourceVideoId: "v1_newest",
        publicUrl: null,
        status: "failed"
      }
    });

    await expect(
      queueAutomatedRender(
        "session-1",
        null,
        "remix",
        "Continue only from the newest remix"
      )
    ).resolves.toBeNull();

    expect(mocks.claimSession).not.toHaveBeenCalled();
    expect(mocks.createAsset).not.toHaveBeenCalled();
    expect(mocks.startVideoRender).not.toHaveBeenCalled();
  });

  it("does not strand a submission when its atomic selection claim is lost", async () => {
    mocks.findSession.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      updatedAt: new Date("2026-07-29T04:00:00.000Z"),
      imageReferenceUrl: null,
      videoDurationSeconds: 8,
      playbackState: {
        currentAssetId: "asset-remix-1",
        nextAssetId: null,
        currentAsset: null
      },
      renderJobs: [],
      visualAssets: []
    });
    mocks.findSubmission.mockResolvedValue({
      referenceImageUrl: null
    });
    mocks.claimSubmission.mockResolvedValue({
      count: 0
    });

    await expect(
      queueAutomatedRender(
        "session-1",
        "submission-already-claimed",
        "remix",
        "Make the latest remix crystalline"
      )
    ).resolves.toBeNull();

    expect(mocks.claimSubmission).toHaveBeenCalledWith({
      where: {
        id: "submission-already-claimed",
        sessionId: "session-1",
        status: "approved",
        selectedAt: null
      },
      data: {
        status: "queued",
        selectedAt: expect.any(Date)
      }
    });
    expect(mocks.createAsset).not.toHaveBeenCalled();
    expect(mocks.createJob).not.toHaveBeenCalled();
    expect(mocks.startVideoRender).not.toHaveBeenCalled();
  });

  it("recovers a fresh ready asset and continues with the next approved render", async () => {
    mocks.findSession
      .mockResolvedValueOnce({
        id: "session-1",
        userId: "user-1",
        autoSelectEnabled: true,
        playbackState: {
          currentAssetId: "asset-current",
          nextAssetId: null,
          emergencyPaused: false
        },
        renderJobs: [],
        visualAssets: [
          {
            id: "asset-ready"
          }
        ],
        submissions: [
          {
            id: "submission-next",
            rankingResult: {
              score: 92,
              winningPrompt: "Wait for the ready asset"
            }
          }
        ]
      })
      .mockResolvedValueOnce({
        id: "session-1",
        userId: "user-1",
        updatedAt: new Date("2026-07-29T17:54:00.000Z"),
        videoDurationSeconds: 4,
        playbackState: {
          currentAssetId: "asset-ready",
          currentAsset: {
            id: "asset-ready",
            publicUrl: "https://example.com/ready.mp4",
            sourceVideoId: "video-ready",
            status: "live"
          }
        },
        renderJobs: [],
        visualAssets: []
      });

    mocks.createAsset.mockResolvedValue({
      id: "asset-next"
    });
    mocks.createJob.mockResolvedValue({
      id: "render-next",
      outputAsset: {
        id: "asset-next"
      }
    });
    mocks.startVideoRender.mockResolvedValue({
      kind: "live",
      requestId: "request-next",
      outputUri: null,
      strategy: "stateful_edit"
    });

    await expect(attemptAutomatedSelection("session-1")).resolves.toMatchObject({
      id: "render-next"
    });

    expect(mocks.takePlaybackAsset).toHaveBeenCalledWith(
      "session-1",
      "asset-ready"
    );
    expect(mocks.promoteOldestReadyAsset).toHaveBeenCalledWith(
      "session-1",
      expect.any(Object),
      {
        allowArchivedRotation: false
      }
    );
    expect(mocks.claimSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "submission-next"
        })
      })
    );
    expect(mocks.startVideoRender).toHaveBeenCalled();
  });

  it("does not render while another render is active", async () => {
    mocks.findSession.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      autoSelectEnabled: true,
      playbackState: {
        currentAssetId: "asset-current",
        nextAssetId: "asset-archived-next",
        emergencyPaused: false
      },
      renderJobs: [
        {
          id: "render-active",
          status: "in_progress"
        }
      ],
      visualAssets: [],
      submissions: [
        {
          id: "submission-next",
          rankingResult: {
            score: 92,
            winningPrompt: "Wait for the active render"
          }
        }
      ]
    });

    await expect(attemptAutomatedSelection("session-1")).resolves.toBeNull();

    expect(mocks.promoteOldestReadyAsset).not.toHaveBeenCalled();
    expect(mocks.claimSubmission).not.toHaveBeenCalled();
    expect(mocks.createAsset).not.toHaveBeenCalled();
    expect(mocks.startVideoRender).not.toHaveBeenCalled();
  });

  it("keeps automated selection from staging archived rotation", async () => {
    mocks.findSession.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      autoSelectEnabled: true,
      playbackState: {
        currentAssetId: "asset-current",
        nextAssetId: null,
        emergencyPaused: false
      },
      renderJobs: [],
      visualAssets: [],
      submissions: []
    });

    await expect(attemptAutomatedSelection("session-1")).resolves.toBeNull();

    expect(mocks.promoteOldestReadyAsset).toHaveBeenCalledWith(
      "session-1",
      expect.any(Object),
      {
        allowArchivedRotation: false
      }
    );
  });

  it("does not immediately undo a fresh transition by taking its staged ready backlog", async () => {
    mocks.findSession.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      autoSelectEnabled: true,
      playbackState: {
        currentAssetId: "asset-manual",
        nextAssetId: "asset-ready-backlog",
        lastTransitionAt: new Date(0),
        emergencyPaused: false
      },
      renderJobs: [],
      visualAssets: [
        {
          id: "asset-ready-backlog",
          updatedAt: new Date()
        }
      ],
      submissions: [
        {
          id: "submission-next",
          rankingResult: {
            score: 92,
            winningPrompt: "Do not undo the manual take"
          }
        }
      ]
    });

    await expect(attemptAutomatedSelection("session-1")).resolves.toBeNull();

    expect(mocks.takePlaybackAsset).not.toHaveBeenCalled();
    expect(mocks.claimSubmission).not.toHaveBeenCalled();
    expect(mocks.startVideoRender).not.toHaveBeenCalled();
  });
});
