import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  waitUntil: vi.fn(),
  completePlaybackTransition: vi.fn(),
  attemptAutomatedSelection: vi.fn()
}));

vi.mock("@vercel/functions", () => ({
  waitUntil: mocks.waitUntil
}));

vi.mock("@/lib/session-service", () => ({
  completePlaybackTransition: mocks.completePlaybackTransition
}));

vi.mock("@/lib/submission-pipeline", () => ({
  attemptAutomatedSelection: mocks.attemptAutomatedSelection
}));

import { POST } from "@/app/api/sessions/[sessionId]/transition/route";

describe("playback transition route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns the transition result while automated selection continues in the background", async () => {
    let rejectSelection: ((reason?: unknown) => void) | undefined;
    const pendingSelection = new Promise<never>((_resolve, reject) => {
      rejectSelection = reject;
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    mocks.completePlaybackTransition.mockResolvedValue(true);
    mocks.attemptAutomatedSelection.mockReturnValue(pendingSelection);

    const response = await POST(
      new Request("http://localhost/api/sessions/session-1/transition", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          assetId: "asset-next"
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
      transitioned: true
    });
    expect(mocks.completePlaybackTransition).toHaveBeenCalledWith(
      "session-1",
      "asset-next"
    );
    expect(mocks.attemptAutomatedSelection).toHaveBeenCalledWith("session-1", {
      allowArchivedRotation: false
    });
    expect(mocks.waitUntil).toHaveBeenCalledOnce();

    const [backgroundWork] = mocks.waitUntil.mock.calls[0] as [Promise<unknown>];
    expect(backgroundWork).toBeInstanceOf(Promise);

    rejectSelection?.(new Error("selection failed"));

    await expect(backgroundWork).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      "[playback-transition] automated selection failed",
      {
        sessionId: "session-1",
        assetId: "asset-next",
        failureReason: "selection failed"
      }
    );

    errorSpy.mockRestore();
  });

  it("skips automated selection when the requested transition was not committed", async () => {
    mocks.completePlaybackTransition.mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/sessions/session-1/transition", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          assetId: "stale-asset"
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
      transitioned: false
    });
    expect(mocks.completePlaybackTransition).toHaveBeenCalledWith(
      "session-1",
      "stale-asset"
    );
    expect(mocks.attemptAutomatedSelection).not.toHaveBeenCalled();
    expect(mocks.waitUntil).not.toHaveBeenCalled();
  });
});
