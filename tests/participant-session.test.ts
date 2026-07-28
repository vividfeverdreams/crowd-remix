import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {}
}));

import {
  getParticipantBlocksRemaining,
  getParticipantModerationEventType,
  isParticipantBanned,
  participantModerationBanThreshold
} from "@/lib/participant-session";

describe("participant session moderation", () => {
  it("bans a device on the third image-or-video moderation block", () => {
    expect(participantModerationBanThreshold).toBe(3);
    expect(isParticipantBanned(2)).toBe(false);
    expect(isParticipantBanned(3)).toBe(true);
    expect(getParticipantBlocksRemaining(1)).toBe(2);
    expect(getParticipantBlocksRemaining(3)).toBe(0);
  });

  it("scopes moderation audit types to the hashed device identity", () => {
    expect(getParticipantModerationEventType("device-hash")).toBe(
      "participant.media_moderation_block.device-hash"
    );
  });
});
