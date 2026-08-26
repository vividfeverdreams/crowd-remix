import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  countAuditEvents: vi.fn()
}));

vi.mock("@/lib/db", () => ({
  db: {
    auditEvent: {
      count: mocks.countAuditEvents
    }
  }
}));

import {
  getParticipantBlocksRemaining,
  getParticipantModerationBlockCount,
  getParticipantModerationEventType,
  isParticipantBanned,
  participantImageModerationEventSummary,
  participantModerationBanThreshold
} from "@/lib/participant-session";

describe("participant session moderation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("bans a device on the third independently rejected image", () => {
    expect(participantModerationBanThreshold).toBe(3);
    expect(isParticipantBanned(2)).toBe(false);
    expect(isParticipantBanned(3)).toBe(true);
    expect(getParticipantBlocksRemaining(1)).toBe(2);
    expect(getParticipantBlocksRemaining(3)).toBe(0);
  });

  it("scopes moderation audit types to the hashed device identity", () => {
    expect(getParticipantModerationEventType("device-hash")).toBe(
      "participant.input_moderation_block.device-hash"
    );
  });

  it("counts current and historical image strikes but excludes provider-video events", async () => {
    mocks.countAuditEvents.mockResolvedValue(2);

    await expect(
      getParticipantModerationBlockCount("session-1", "device-hash")
    ).resolves.toBe(2);
    expect(mocks.countAuditEvents).toHaveBeenCalledWith({
      where: {
        sessionId: "session-1",
        OR: [
          {
            type: "participant.input_moderation_block.device-hash"
          },
          {
            type: "participant.media_moderation_block.device-hash",
            summary: participantImageModerationEventSummary
          }
        ]
      }
    });
  });
});
