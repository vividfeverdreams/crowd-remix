import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ShowScreen } from "@/components/show-screen";
import type { SessionSnapshot } from "@/lib/snapshot";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

describe("show screen video presentation", () => {
  it("loops the active video with persistent bottom-left attribution and no repeated intro", () => {
    const currentAsset = {
      id: "asset-current",
      kind: "video",
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
    expect(markup).toContain('loop=""');
    expect(markup).toContain("Nova");
    expect(markup).toContain("Chrome clouds melt over the dance floor");
    expect(markup).not.toContain("Incoming remix");
  });
});
