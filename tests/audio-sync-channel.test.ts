import { describe, expect, it } from "vitest";
import {
  createAudioSyncBase,
  getAudioSyncChannelName,
  isAudioSyncMessage
} from "@/lib/audio-sync-channel";

describe("audio sync channel protocol", () => {
  it("scopes each channel to one live session", () => {
    expect(getAudioSyncChannelName("session-123")).toBe("dream-sequence:audio-sync:session-123");
  });

  it("accepts a complete reactive audio frame", () => {
    const frame = {
      ...createAudioSyncBase("session-123", "dashboard-1"),
      type: "frame",
      connected: true,
      intensity: 0.85,
      autoTakeOnCue: true,
      effect: "glitch-jitter",
      levels: {
        energy: 0.4,
        bass: 0.6,
        mid: 0.3,
        high: 0.2,
        beatPulse: 1
      }
    };

    expect(isAudioSyncMessage(frame)).toBe(true);
  });

  it("rejects malformed cross-window messages", () => {
    expect(
      isAudioSyncMessage({
        version: 2,
        sessionId: "session-123",
        sourceId: "unknown",
        sentAt: Date.now(),
        type: "frame",
        connected: true,
        intensity: "loud",
        autoTakeOnCue: true,
        effect: "not-an-effect",
        levels: {}
      })
    ).toBe(false);
  });

  it("rejects stale protocol messages from browser tabs left open during a deployment", () => {
    expect(
      isAudioSyncMessage({
        version: 2,
        sessionId: "session-123",
        sourceId: "old-dashboard",
        sentAt: Date.now(),
        type: "state",
        connected: true,
        intensity: 0.85,
        autoTakeOnCue: true,
        effect: "bass-zoom"
      })
    ).toBe(false);
  });

  it("rejects frames with an unknown effect", () => {
    expect(
      isAudioSyncMessage({
        ...createAudioSyncBase("session-123", "dashboard-1"),
        type: "frame",
        connected: true,
        intensity: 0.85,
        autoTakeOnCue: true,
        effect: "unknown-vfx",
        levels: {
          energy: 0.4,
          bass: 0.6,
          mid: 0.3,
          high: 0.2,
          beatPulse: 1
        }
      })
    ).toBe(false);
  });

  it("accepts a manual take that targets a historical generation", () => {
    expect(
      isAudioSyncMessage({
        ...createAudioSyncBase("session-123", "history-control:user-1"),
        type: "take",
        eventId: "history:asset-123:1",
        assetId: "asset-123"
      })
    ).toBe(true);

    expect(
      isAudioSyncMessage({
        ...createAudioSyncBase("session-123", "history-control:user-1"),
        type: "take",
        eventId: "history:asset-123:2",
        assetId: 123
      })
    ).toBe(false);
  });
});
