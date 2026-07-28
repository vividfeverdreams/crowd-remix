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
  });

  it("places an owned archived generation in the next slot", async () => {
    mocks.findSession.mockResolvedValue({
      id: "session-1",
      playbackState: {
        id: "playback-1",
        currentAssetId: "asset-live"
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
    expect(mocks.updatePlayback).toHaveBeenCalledWith({
      where: {
        id: "playback-1"
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

  it("ignores a duplicate request after another screen advanced the queue", async () => {
    mocks.findPlayback.mockResolvedValue({
      id: "playback-1",
      currentAssetId: "asset-remix",
      nextAssetId: "asset-after-remix"
    });

    await expect(
      completePlaybackTransition("session-1", "asset-remix")
    ).resolves.toBeNull();

    expect(mocks.updateAsset).not.toHaveBeenCalled();
    expect(mocks.updatePlayback).not.toHaveBeenCalled();
    expect(mocks.updatePlaybackMany).not.toHaveBeenCalled();
    expect(mocks.promoteReadyAsset).not.toHaveBeenCalled();
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });
});
