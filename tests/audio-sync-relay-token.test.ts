import { describe, expect, it } from "vitest";
import { createAudioSyncRelayToken, parseAudioSyncRelayToken } from "@/lib/audio-sync-relay-token";

describe("audio synchronization relay token", () => {
  it("round-trips a signed session-scoped token", () => {
    const token = createAudioSyncRelayToken("session-123", "user-456");

    expect(parseAudioSyncRelayToken(token)).toMatchObject({
      sessionId: "session-123",
      userId: "user-456"
    });
  });

  it("rejects a tampered token", () => {
    const token = createAudioSyncRelayToken("session-123", "user-456");
    const [payload, signature] = token.split(".");

    expect(parseAudioSyncRelayToken(`${payload}x.${signature}`)).toBeNull();
  });
});
