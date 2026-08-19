import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  getVideoSlotPresentation,
  requestVideoPlayback,
  ShowScreen
} from "@/components/show-screen";
import type { SessionSnapshot } from "@/lib/snapshot";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

describe("show screen video presentation", () => {
  it("switches video layers without a compositor opacity transition", () => {
    expect(getVideoSlotPresentation(true)).toEqual({
      visibility: "visible",
      zIndex: 2
    });
    expect(getVideoSlotPresentation(false)).toEqual({
      visibility: "hidden",
      zIndex: 1
    });
    expect(getVideoSlotPresentation(true)).not.toHaveProperty("opacity");
  });

  it("recognizes playback starting even if the play promise remains pending", async () => {
    const neverSettles = new Promise<void>(() => undefined);
    class DeferredPlaybackVideo extends EventTarget {
      paused = true;

      play() {
        queueMicrotask(() => {
          this.paused = false;
          this.dispatchEvent(new Event("playing"));
        });

        return neverSettles;
      }
    }
    const video = new DeferredPlaybackVideo();

    const completed = await Promise.race([
      requestVideoPlayback(video as unknown as HTMLVideoElement).then(() => true),
      new Promise<false>((resolve) => {
        setTimeout(() => resolve(false), 100);
      })
    ]);

    expect(completed).toBe(true);
    expect(video.paused).toBe(false);
  });

  it("renders asset-bound bottom-right attribution and no repeated intro", () => {
    const currentAsset = {
      id: "asset-current",
      kind: "remix",
      title: "Current remix",
      promptText: "A fallback prompt",
      publicUrl: "/current-loop.mp4",
      status: "live",
      createdAt: new Date("2026-07-28T00:00:00.000Z"),
      sourceSubmission: {
        rawText: "Chrome clouds melt over the dance floor",
        sender: "Nova",
        source: "web",
        referenceImageUrl: null
      }
    };
    const snapshot = {
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

    const markup = renderToStaticMarkup(
      React.createElement(ShowScreen, {
        initialSnapshot: snapshot
      })
    );

    expect(markup).toContain('data-asset-id="asset-current"');
    expect(markup).toContain('src="/current-loop.mp4"');
    expect(markup).toContain("visibility:visible");
    expect(markup).not.toContain('autoplay=""');
    expect(markup).not.toContain(' loop=""');
    const videoMarkup = markup.match(/<video[^>]*><\/video>/)?.[0] ?? "";
    expect(videoMarkup).not.toContain("transition-opacity");
    expect(videoMarkup).not.toContain("translateZ(0)");
    expect(markup).toContain("Nova");
    expect(markup).toContain("Chrome clouds melt over the dance floor");
    expect(markup).toContain('data-attribution-asset-id="asset-current"');
    expect(markup).toContain("right-[clamp(1rem,3vw,3rem)]");
    expect(markup).not.toContain("left-[clamp(1rem,3vw,3rem)]");
    expect(markup).not.toContain("Incoming remix");
  });

  it("does not attach crowd attribution to the original session video", () => {
    const originalAsset = {
      id: "asset-original",
      kind: "seed",
      title: "Original",
      promptText: "Original session visual",
      publicUrl: "/original.mp4",
      status: "live",
      createdAt: new Date("2026-07-28T00:00:00.000Z"),
      sourceSubmission: null
    };
    const snapshot = {
      session: {
        id: "session-1",
        userId: "user-1",
        playbackState: {
          currentAsset: originalAsset,
          nextAsset: null,
          fallbackAsset: null,
          crossfadeSeconds: 2
        },
        visualAssets: [originalAsset],
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

    const markup = renderToStaticMarkup(
      React.createElement(ShowScreen, {
        initialSnapshot: snapshot
      })
    );

    expect(markup).toContain('data-asset-id="asset-original"');
    expect(markup).not.toContain("data-attribution-asset-id");
  });

  it("shows the estimated progress received from the live session stream", () => {
    const snapshot = {
      session: {
        id: "session-1",
        userId: "user-1",
        playbackState: null,
        visualAssets: [],
        renderJobs: [
          {
            id: "render-active",
            mode: "remix",
            status: "in_progress",
            promptText: "Liquid chrome skyline",
            failureReason: null,
            createdAt: new Date("2026-08-01T00:00:00.000Z"),
            progress: 42
          }
        ],
        wordmarkAudioReactiveOnly: false,
        wordmarkOverlayVisible: false,
        wordmarkOpacity: 1,
        wordmarkSize: 1,
        progressOverlayVisible: true,
        qrOverlayVisible: false
      },
      queueHealth: {
        approvedCount: 0,
        queuedRenderCount: 0,
        renderingCount: 1,
        readyAssetCount: 0,
        waitingOnRender: true
      }
    } as unknown as NonNullable<SessionSnapshot>;

    const markup = renderToStaticMarkup(
      React.createElement(ShowScreen, {
        initialSnapshot: snapshot
      })
    );

    expect(markup).toContain("EST. 42%");
    expect(markup).toContain('aria-label="Estimated next remix generation progress"');
    expect(markup).toContain('aria-valuenow="42"');
    expect(markup).toContain("width:42%");
  });
});
