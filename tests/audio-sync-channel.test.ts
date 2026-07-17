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
        version: 1,
        sessionId: "session-123",
        sourceId: "unknown",
        sentAt: Date.now(),
        type: "frame",
        connected: true,
        intensity: "loud",
        autoTakeOnCue: true,
        levels: {}
      })
    ).toBe(false);
  });
});
