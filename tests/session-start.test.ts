import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findOwnedSession: vi.fn(),
  updateSession: vi.fn(),
  findGenerationState: vi.fn(),
  findPlayback: vi.fn(),
  updatePlaybackMany: vi.fn(),
  updateAsset: vi.fn(),
  queueAutomatedRender: vi.fn(),
  recordAuditEvent: vi.fn()
}));

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: vi.fn(async (callback) =>
      callback({
        playbackState: {
          updateMany: mocks.updatePlaybackMany
        },
        visualAsset: {
          update: mocks.updateAsset
        }
      })
    ),
    dJSession: {
      findFirst: mocks.findOwnedSession,
      update: mocks.updateSession,
      findUnique: mocks.findGenerationState
    },
    playbackState: {
      findUnique: mocks.findPlayback
    }
  }
}));

vi.mock("@/lib/audit", () => ({
  recordAuditEvent: mocks.recordAuditEvent
}));

vi.mock("@/lib/playback-queue", () => ({
  promoteOldestReadyAsset: vi.fn()
}));

vi.mock("@/lib/submission-pipeline", () => ({
  queueAutomatedRender: mocks.queueAutomatedRender
}));

import {
  buildFallbackRemixPrompt,
  initialGenerationQueueFailureMessage,
  startDjSession
} from "@/lib/session-service";

describe("starting a session's first video", () => {
  const startedAt = new Date("2026-07-29T14:30:41.000Z");

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findOwnedSession.mockResolvedValue({
      id: "session-1"
    });
    mocks.updateSession.mockResolvedValue({
      id: "session-1",
      name: "Live set",
      basePrompt: "A liquid chrome dream",
      motionRules: "Locked-off static camera; pulse the light on phrase changes",
      status: "live",
      startedAt,
      playbackState: {
        currentAssetId: null
      },
      renderJobs: []
    });
    mocks.recordAuditEvent.mockResolvedValue({});
    mocks.updatePlaybackMany.mockResolvedValue({
      count: 1
    });
    mocks.updateAsset.mockResolvedValue({});
  });

  it("fails explicitly when no first-video job was created", async () => {
    mocks.queueAutomatedRender.mockResolvedValue(null);
    mocks.findGenerationState.mockResolvedValue({
      playbackState: {
        currentAssetId: null
      },
      renderJobs: [],
      visualAssets: []
    });

    await expect(startDjSession("session-1", "user-1")).rejects.toThrow(
      initialGenerationQueueFailureMessage
    );
    expect(mocks.findGenerationState).toHaveBeenCalledWith({
      where: {
        id: "session-1"
      },
      select: expect.objectContaining({
        playbackState: expect.any(Object),
        renderJobs: expect.any(Object)
      })
    });
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });

  it("accepts a concurrent seed job instead of reporting a false failure", async () => {
    mocks.queueAutomatedRender.mockResolvedValue(null);
    mocks.findGenerationState.mockResolvedValue({
      playbackState: {
        currentAssetId: null
      },
      renderJobs: [
        {
          id: "seed-concurrent"
        }
      ],
      visualAssets: []
    });

    await expect(startDjSession("session-1", "user-1")).resolves.toMatchObject({
      id: "session-1",
      status: "live"
    });
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "session.started",
        sessionId: "session-1"
      })
    );
  });

  it("fails explicitly when the generation state cannot be recovered", async () => {
    mocks.queueAutomatedRender.mockResolvedValue(null);
    mocks.findGenerationState.mockResolvedValue(null);

    await expect(startDjSession("session-1", "user-1")).rejects.toThrow(
      initialGenerationQueueFailureMessage
    );
  });

  it("adopts a completed ready seed when playback was never assigned", async () => {
    mocks.queueAutomatedRender.mockResolvedValue(null);
    mocks.findGenerationState.mockResolvedValue({
      playbackState: {
        currentAssetId: null
      },
      renderJobs: [],
      visualAssets: [
        {
          id: "asset-ready"
        }
      ]
    });

    await expect(startDjSession("session-1", "user-1")).resolves.toMatchObject({
      id: "session-1",
      status: "live"
    });
    expect(mocks.updatePlaybackMany).toHaveBeenCalledWith({
      where: {
        sessionId: "session-1",
        currentAssetId: null
      },
      data: {
        currentAssetId: "asset-ready",
        status: "live",
        lastTransitionAt: expect.any(Date)
      }
    });
    expect(mocks.updateAsset).toHaveBeenCalledWith({
      where: {
        id: "asset-ready"
      },
      data: {
        status: "live"
      }
    });
  });

  it("does not perform a recovery query when the seed starts normally", async () => {
    mocks.queueAutomatedRender.mockResolvedValue({
      id: "seed-1"
    });

    await startDjSession("session-1", "user-1");

    expect(mocks.queueAutomatedRender).toHaveBeenCalledWith(
      "session-1",
      null,
      "seed",
      "A liquid chrome dream"
    );
    expect(mocks.findGenerationState).not.toHaveBeenCalled();
  });
});

describe("fallback remix creative prompt", () => {
  it("keeps the requested visual reset without duplicating provider requirements", () => {
    const prompt = buildFallbackRemixPrompt({
      basePrompt: "A molten glass city loops through ultraviolet rain."
    });

    expect(prompt).toContain("A molten glass city loops through ultraviolet rain.");
    expect(prompt).toContain("fresh geometric pulse");
    expect(prompt).toContain("visually coherent");
    expect(prompt).not.toContain("Follow the artist's motion and camera rules");
    expect(prompt).not.toContain("venue-safe");
    expect(prompt).not.toContain("calmer geometric pulse");
    expect(prompt).not.toContain("resilient club-safe motion");
  });
});
