import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  getDashboardShowFrameSource,
  isDashboardShowFullscreen,
  requestDashboardShowFullscreen
} from "@/components/dashboard-shell";
import { ShowScreen } from "@/components/show-screen";
import type { SessionSnapshot } from "@/lib/snapshot";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

function createSnapshot() {
  const currentAsset = {
    id: "asset-current",
    kind: "seed",
    title: "Current loop",
    promptText: "A live visual",
    publicUrl: "/current-loop.mp4",
    status: "live",
    createdAt: new Date("2026-08-03T00:00:00.000Z"),
    sourceSubmission: null
  };

  return {
    session: {
      id: "session-1",
      userId: "user-1",
      playbackState: {
        currentAsset,
        nextAsset: null,
        fallbackAsset: null,
        crossfadeSeconds: 2
      },
      visualAssets: [currentAsset],
      renderJobs: [],
      wordmarkAudioReactiveOnly: false,
      wordmarkOverlayVisible: false,
      wordmarkOpacity: 1,
      wordmarkSize: 1,
      progressOverlayVisible: false,
      qrOverlayVisible: false
    },
    queueHealth: {
      approvedCount: 0,
      queuedRenderCount: 0,
      renderingCount: 0,
      readyAssetCount: 0,
      waitingOnRender: false
    }
  } as unknown as NonNullable<SessionSnapshot>;
}

describe("dashboard fullscreen show", () => {
  it.each([false, true])(
    "does not render a fullscreen prompt when monitor mode is %s",
    (isMonitor) => {
      const markup = renderToStaticMarkup(
        React.createElement(ShowScreen, {
          initialSnapshot: createSnapshot(),
          isMonitor
        })
      ).toLowerCase();

      expect(markup).not.toContain("presentation mode");
      expect(markup).not.toContain("enter fullscreen");
    }
  );

  it("keeps the inline monitor read-only and enables playback control in fullscreen", () => {
    expect(getDashboardShowFrameSource("/show/session-1", false)).toBe(
      "/show/session-1?monitor=1"
    );
    expect(getDashboardShowFrameSource("/show/session-1", true)).toBe(
      "/show/session-1"
    );
  });

  it("recognizes only the dashboard show iframe as fullscreen", () => {
    const frame = {} as HTMLIFrameElement;
    const otherElement = {} as Element;

    expect(isDashboardShowFullscreen(frame, frame)).toBe(true);
    expect(isDashboardShowFullscreen(otherElement, frame)).toBe(false);
    expect(isDashboardShowFullscreen(null, null)).toBe(false);
  });

  it("requests fullscreen directly on the dashboard show iframe", async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    const frame = { requestFullscreen } as unknown as HTMLIFrameElement;

    await requestDashboardShowFullscreen(frame);

    expect(requestFullscreen).toHaveBeenCalledOnce();
    expect(requestFullscreen).toHaveBeenCalledWith();
  });

  it("reports browsers that do not support fullscreen", async () => {
    await expect(requestDashboardShowFullscreen(null)).rejects.toThrow(
      "Fullscreen is not supported in this browser."
    );
  });
});
