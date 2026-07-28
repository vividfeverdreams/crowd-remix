import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findJobs: vi.fn(),
  findSession: vi.fn(),
  findSubmission: vi.fn(),
  createAsset: vi.fn(),
  createJob: vi.fn(),
  updateJob: vi.fn(),
  updateSubmission: vi.fn(),
  promoteOldestReadyAsset: vi.fn(),
  reconcileRenderJob: vi.fn(),
  completeGeminiVideoRender: vi.fn(),
  startVideoRender: vi.fn()
}));

vi.mock("@/lib/db", () => ({
  db: {
    dJSession: {
      findUnique: mocks.findSession
    },
    promptSubmission: {
      findUnique: mocks.findSubmission,
      update: mocks.updateSubmission
    },
    renderJob: {
      create: mocks.createJob,
      findMany: mocks.findJobs,
      update: mocks.updateJob
    },
    visualAsset: {
      create: mocks.createAsset
    }
  }
}));

vi.mock("@/lib/rendering", () => ({
  completeGeminiVideoRender: mocks.completeGeminiVideoRender,
  failRenderJob: vi.fn(),
  formatVideoModerationFailureReason: (message: string) => message,
  isVideoModerationError: vi.fn().mockReturnValue(false),
  reconcileRenderJob: mocks.reconcileRenderJob,
  startVideoRender: mocks.startVideoRender
}));

vi.mock("@/lib/playback-queue", () => ({
  promoteOldestReadyAsset: mocks.promoteOldestReadyAsset
}));

vi.mock("@/lib/google-key-store", () => ({
  getEffectiveGeminiApiKeyForUser: vi.fn().mockResolvedValue("test-api-key")
}));

vi.mock("@/lib/audit", () => ({
  recordAuditEvent: vi.fn()
}));

import {
  attemptAutomatedSelection,
  reconcilePendingRenderJobs
} from "@/lib/submission-pipeline";

describe("submission render queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.promoteOldestReadyAsset.mockResolvedValue(null);
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
          nextAssetId: null,
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
        videoDurationSeconds: 6,
        playbackState: {
          currentAssetId: "asset-current",
          nextAssetId: null
        },
        renderJobs: [],
        visualAssets: [
          {
            id: "asset-current",
            status: "live",
            sourceVideoId: "file_current",
            publicUrl: "https://example.com/current.mp4"
          }
        ]
      });
    mocks.updateSubmission.mockResolvedValue({});
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
    expect(mocks.updateSubmission).toHaveBeenCalledWith({
      where: {
        id: "submission-next"
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
        prompt: "Compiled private model prompt",
        remixReferenceImageUrl: "https://example.com/reference.jpg",
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
        visualAssets: [
          {
            id: "asset-current",
            status: "live",
            sourceVideoId: "file_current",
            publicUrl: "https://example.com/current.mp4"
          }
        ]
      });
    mocks.updateSubmission.mockResolvedValue({});
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

    expect(mocks.updateSubmission).toHaveBeenCalledWith({
      where: {
        id: "submission-next"
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
        prompt: "A fresh audience remix",
        sourceVideoId: "file_current"
      })
    );
  });

  it("does not render while a fresh ready asset is still unplayed", async () => {
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
    });

    await expect(attemptAutomatedSelection("session-1")).resolves.toBeNull();

    expect(mocks.promoteOldestReadyAsset).not.toHaveBeenCalled();
    expect(mocks.updateSubmission).not.toHaveBeenCalled();
    expect(mocks.createAsset).not.toHaveBeenCalled();
    expect(mocks.startVideoRender).not.toHaveBeenCalled();
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
    expect(mocks.updateSubmission).not.toHaveBeenCalled();
    expect(mocks.createAsset).not.toHaveBeenCalled();
    expect(mocks.startVideoRender).not.toHaveBeenCalled();
  });
});
