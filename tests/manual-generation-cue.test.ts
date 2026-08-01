import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findSession: vi.fn(),
  findAsset: vi.fn(),
  findPlayback: vi.fn(),
  updateAsset: vi.fn(),
  updatePlayback: vi.fn(),
  updatePlaybackMany: vi.fn(),
  promoteReadyAsset: vi.fn(),
  recordAuditEvent: vi.fn()
}));

vi.mock("@/lib/db", () => {
  const transactionClient = {
    dJSession: {
      findFirst: mocks.findSession
    },
    visualAsset: {
      findFirst: mocks.findAsset,
      update: mocks.updateAsset
    },
    playbackState: {
      findUnique: mocks.findPlayback,
      update: mocks.updatePlayback,
      updateMany: mocks.updatePlaybackMany
    },
    promptSubmission: {
      update: vi.fn()
    }
  };

  return {
    db: {
      $transaction: vi.fn((callback) => callback(transactionClient))
    }
  };
});

vi.mock("@/lib/audit", () => ({
  recordAuditEvent: mocks.recordAuditEvent
}));

vi.mock("@/lib/playback-queue", () => ({
  promoteOldestReadyAsset: mocks.promoteReadyAsset
}));

vi.mock("@/lib/show-overlay-state", () => ({
  normalizeShowWordmarkOpacity: (value: number) => value,
  normalizeShowWordmarkSize: (value: number) => value,
  showProgressOverlayDisabledEvent: "show.progress.disabled",
  showProgressOverlayEnabledEvent: "show.progress.enabled",
  showQrOverlayDisabledEvent: "show.qr.disabled",
  showQrOverlayEnabledEvent: "show.qr.enabled",
  showWordmarkAudioReactiveOnlyDisabledEvent: "show.wordmark.audio.disabled",
  showWordmarkAudioReactiveOnlyEnabledEvent: "show.wordmark.audio.enabled",
  showWordmarkOpacityEvent: "show.wordmark.opacity",
  showWordmarkSizeEvent: "show.wordmark.size",
  showWordmarkOverlayDisabledEvent: "show.wordmark.disabled",
  showWordmarkOverlayEnabledEvent: "show.wordmark.enabled"
}));

vi.mock("@/lib/submission-pipeline", () => ({
  queueAutomatedRender: vi.fn()
}));

import { completePlaybackTransition, cueHistoricalGeneration } from "@/lib/session-service";
import { takePlaybackAsset } from "@/lib/playback-transition";

describe("manual historical generation cue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateAsset.mockResolvedValue({});
    mocks.updatePlayback.mockResolvedValue({});
    mocks.updatePlaybackMany.mockResolvedValue({
      count: 1
    });
    mocks.promoteReadyAsset.mockResolvedValue(null);
    mocks.recordAuditEvent.mockResolvedValue({});
    mocks.findAsset.mockResolvedValue({
      id: "asset-remix",
      sourceSubmissionId: null
    });
  });

  it("places an owned archived generation in the next slot", async () => {
    mocks.findSession.mockResolvedValue({
      id: "session-1",
      playbackState: {
        id: "playback-1",
        currentAssetId: "asset-live",
        nextAssetId: null
      }
    });
    mocks.findAsset.mockResolvedValue({
      id: "asset-history",
      title: "DREAM SEQUENCE",
      sourceSubmission: {
        rawText: "Make it a neon fish bowl"
      }
    });

    await expect(
      cueHistoricalGeneration("session-1", "user-1", "asset-history")
    ).resolves.toMatchObject({
      id: "asset-history"
    });

    expect(mocks.updateAsset).toHaveBeenCalledWith({
      where: {
        id: "asset-history"
      },
      data: {
        status: "ready"
      }
    });
    expect(mocks.updatePlaybackMany).toHaveBeenCalledWith({
      where: {
        id: "playback-1",
        currentAssetId: "asset-live",
        nextAssetId: null
      },
      data: {
        nextAssetId: "asset-history",
        status: "live"
      }
    });
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "playback.history_cued",
        sessionId: "session-1",
        userId: "user-1"
      })
    );
  });

  it("refuses to re-cue the asset that is already live", async () => {
    mocks.findSession.mockResolvedValue({
      id: "session-1",
      playbackState: {
        id: "playback-1",
        currentAssetId: "asset-live"
      }
    });

    await expect(
      cueHistoricalGeneration("session-1", "user-1", "asset-live")
    ).resolves.toBeNull();

    expect(mocks.findAsset).not.toHaveBeenCalled();
    expect(mocks.updatePlayback).not.toHaveBeenCalled();
  });

  it("does not create current and next references to the same asset during a cue race", async () => {
    mocks.findSession.mockResolvedValue({
      id: "session-1",
      playbackState: {
        id: "playback-1",
        currentAssetId: "asset-live",
        nextAssetId: null
      }
    });
    mocks.findAsset.mockResolvedValue({
      id: "asset-history",
      title: "DREAM SEQUENCE",
      sourceSubmission: null
    });
    mocks.updatePlaybackMany.mockResolvedValueOnce({
      count: 0
    });
    mocks.findPlayback.mockResolvedValue({
      currentAssetId: "asset-history"
    });

    await expect(
      cueHistoricalGeneration("session-1", "user-1", "asset-history")
    ).resolves.toMatchObject({
      id: "asset-history"
    });

    expect(mocks.updateAsset).not.toHaveBeenCalled();
    expect(mocks.updatePlayback).not.toHaveBeenCalled();
  });
});

describe("playback transition target", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateAsset.mockResolvedValue({});
    mocks.updatePlayback.mockResolvedValue({});
    mocks.updatePlaybackMany.mockResolvedValue({
      count: 1
    });
    mocks.promoteReadyAsset.mockResolvedValue(null);
    mocks.recordAuditEvent.mockResolvedValue({});
    mocks.findAsset.mockResolvedValue({
      id: "asset-remix",
      sourceSubmissionId: null
    });
  });

  it("promotes the requested next asset", async () => {
    mocks.findPlayback.mockResolvedValue({
      id: "playback-1",
      currentAssetId: "asset-live",
      nextAssetId: "asset-remix"
    });

    await expect(
      completePlaybackTransition("session-1", "asset-remix")
    ).resolves.toBe(true);

    expect(mocks.updatePlaybackMany).toHaveBeenCalledWith({
      where: {
        id: "playback-1",
        currentAssetId: "asset-live",
        nextAssetId: "asset-remix"
      },
      data: {
        currentAssetId: "asset-remix",
        nextAssetId: null,
        status: "live",
        lastTransitionAt: expect.any(Date)
      }
    });
    expect(mocks.updateAsset).toHaveBeenNthCalledWith(1, {
      where: {
        id: "asset-live"
      },
      data: {
        status: "archived"
      }
    });
    expect(mocks.updateAsset).toHaveBeenNthCalledWith(2, {
      where: {
        id: "asset-remix"
      },
      data: {
        status: "live"
      }
    });
  });

  it("accepts a predicted rotation asset when the explicit next slot is empty", async () => {
    mocks.findPlayback.mockResolvedValue({
      id: "playback-1",
      currentAssetId: "asset-live",
      nextAssetId: null
    });

    await expect(
      completePlaybackTransition("session-1", "asset-remix")
    ).resolves.toBe(true);

    expect(mocks.updatePlaybackMany).toHaveBeenCalledWith({
      where: {
        id: "playback-1",
        currentAssetId: "asset-live",
        nextAssetId: null
      },
      data: {
        currentAssetId: "asset-remix",
        nextAssetId: null,
        status: "live",
        lastTransitionAt: expect.any(Date)
      }
    });
  });

  it("rejects a predicted rotation asset when another asset is explicitly queued", async () => {
    mocks.findPlayback.mockResolvedValue({
      id: "playback-1",
      currentAssetId: "asset-live",
      nextAssetId: "asset-other"
    });

    await expect(
      completePlaybackTransition("session-1", "asset-remix")
    ).resolves.toBeNull();

    expect(mocks.findAsset).not.toHaveBeenCalled();
    expect(mocks.updatePlaybackMany).not.toHaveBeenCalled();
  });

  it("keeps a committed transition successful when audit logging fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.findPlayback.mockResolvedValue({
      id: "playback-1",
      currentAssetId: "asset-live",
      nextAssetId: "asset-remix"
    });
    mocks.recordAuditEvent.mockRejectedValueOnce(new Error("audit unavailable"));

    await expect(
      completePlaybackTransition("session-1", "asset-remix")
    ).resolves.toBe(true);

    expect(errorSpy).toHaveBeenCalledWith(
      "[playback-transition] audit logging failed",
      {
        sessionId: "session-1",
        transitionedAssetId: "asset-remix",
        failureReason: "audit unavailable"
      }
    );

    errorSpy.mockRestore();
  });

  it("treats a duplicate request as an idempotent success after another screen advanced the queue", async () => {
    mocks.findPlayback.mockResolvedValue({
      id: "playback-1",
      currentAssetId: "asset-remix",
      nextAssetId: "asset-after-remix"
    });

    await expect(
      completePlaybackTransition("session-1", "asset-remix")
    ).resolves.toBe(true);

    expect(mocks.updateAsset).not.toHaveBeenCalled();
    expect(mocks.updatePlayback).not.toHaveBeenCalled();
    expect(mocks.updatePlaybackMany).not.toHaveBeenCalled();
    expect(mocks.promoteReadyAsset).not.toHaveBeenCalled();
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });

  it("promotes a ready asset directly when no show client is open", async () => {
    mocks.findPlayback.mockResolvedValue({
      id: "playback-1",
      currentAssetId: "asset-live",
      nextAssetId: "asset-rotation"
    });
    mocks.findAsset.mockResolvedValue({
      id: "asset-ready",
      sourceSubmissionId: null
    });

    await expect(
      takePlaybackAsset("session-1", "asset-ready")
    ).resolves.toBe(true);

    expect(mocks.updatePlaybackMany).toHaveBeenCalledWith({
      where: {
        id: "playback-1",
        currentAssetId: "asset-live",
        nextAssetId: "asset-rotation"
      },
      data: {
        currentAssetId: "asset-ready",
        nextAssetId: null,
        status: "live",
        lastTransitionAt: expect.any(Date)
      }
    });
  });
});
