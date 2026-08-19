import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  attemptAutomatedSelection: vi.fn(),
  completePlaybackTransition: vi.fn(),
  cueHistoricalGeneration: vi.fn(),
  forceTransitionToNext: vi.fn(),
  publishAudioSyncMessage: vi.fn(),
  waitUntil: vi.fn()
}));

vi.mock("@vercel/functions", () => ({
  waitUntil: mocks.waitUntil
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn().mockResolvedValue({
    id: "user-1"
  })
}));

vi.mock("@/lib/session-service", () => ({
  completePlaybackTransition: mocks.completePlaybackTransition,
  cueHistoricalGeneration: mocks.cueHistoricalGeneration,
  forceTransitionToNext: mocks.forceTransitionToNext,
  queueFallbackRemix: vi.fn(),
  setSelectionPause: vi.fn(),
  setShowProgressOverlayVisibility: vi.fn(),
  setShowQrOverlayVisibility: vi.fn(),
  setShowWordmarkAudioReactiveOnly: vi.fn(),
  setShowWordmarkOpacity: vi.fn(),
  setShowWordmarkSize: vi.fn(),
  setShowWordmarkOverlayVisibility: vi.fn(),
  stopDjSession: vi.fn()
}));

vi.mock("@/lib/submission-pipeline", () => ({
  attemptAutomatedSelection: mocks.attemptAutomatedSelection
}));

vi.mock("@/lib/audio-sync-relay", () => ({
  publishAudioSyncMessage: mocks.publishAudioSyncMessage
}));

import { POST } from "@/app/api/sessions/[sessionId]/control/route";

describe("manual generation control", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cueHistoricalGeneration.mockResolvedValue({
      id: "asset-history",
      sourceSubmission: {
        rawText: "Make it a neon fish bowl"
      }
    });
    mocks.completePlaybackTransition.mockResolvedValue(true);
    mocks.publishAudioSyncMessage.mockResolvedValue(undefined);
    mocks.attemptAutomatedSelection.mockResolvedValue(null);
  });

  it("makes the selected generation current before returning success", async () => {
    const response = await POST(
      new Request("http://localhost/api/sessions/session-1/control", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          action: "cue-generation",
          assetId: "asset-history"
        })
      }),
      {
        params: Promise.resolve({
          sessionId: "session-1"
        })
      }
    );

    await expect(response.json()).resolves.toEqual({
      ok: true,
      assetId: "asset-history"
    });
    expect(mocks.completePlaybackTransition).toHaveBeenCalledWith(
      "session-1",
      "asset-history"
    );
    expect(mocks.publishAudioSyncMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "take",
        assetId: "asset-history"
      })
    );
    expect(
      mocks.completePlaybackTransition.mock.invocationCallOrder[0]
    ).toBeLessThan(mocks.publishAudioSyncMessage.mock.invocationCallOrder[0]);
    expect(mocks.attemptAutomatedSelection).toHaveBeenCalledWith("session-1");
    expect(mocks.waitUntil).toHaveBeenCalledOnce();
  });

  it("keeps skip-next follow-up selection fresh-only", async () => {
    const response = await POST(
      new Request("http://localhost/api/sessions/session-1/control", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          action: "skip-next"
        })
      }),
      {
        params: Promise.resolve({
          sessionId: "session-1"
        })
      }
    );

    await expect(response.json()).resolves.toEqual({
      ok: true
    });
    expect(mocks.forceTransitionToNext).toHaveBeenCalledWith(
      "session-1",
      "user-1"
    );
    expect(mocks.attemptAutomatedSelection).toHaveBeenCalledWith("session-1");
  });

  it("reports a conflict instead of claiming an uncommitted selection succeeded", async () => {
    mocks.completePlaybackTransition.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/sessions/session-1/control", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          action: "cue-generation",
          assetId: "asset-history"
        })
      }),
      {
        params: Promise.resolve({
          sessionId: "session-1"
        })
      }
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "That generation could not become the live video."
    });
    expect(mocks.publishAudioSyncMessage).not.toHaveBeenCalled();
    expect(mocks.waitUntil).not.toHaveBeenCalled();
  });

  it("keeps a committed selection successful when the take relay is unavailable", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.publishAudioSyncMessage.mockRejectedValueOnce(
      new Error("relay unavailable")
    );

    const response = await POST(
      new Request("http://localhost/api/sessions/session-1/control", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          action: "cue-generation",
          assetId: "asset-history"
        })
      }),
      {
        params: Promise.resolve({
          sessionId: "session-1"
        })
      }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      assetId: "asset-history"
    });
    expect(errorSpy).toHaveBeenCalledWith(
      "[manual-generation] take relay failed after promotion",
      {
        sessionId: "session-1",
        assetId: "asset-history",
        failureReason: "relay unavailable"
      }
    );

    errorSpy.mockRestore();
  });
});
