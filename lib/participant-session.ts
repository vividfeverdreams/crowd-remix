import { db } from "@/lib/db";

export const participantModerationBanThreshold = 3;
const participantModerationEventPrefix = "participant.media_moderation_block.";
const legacyVideoModerationEventPrefix = "participant.video_moderation_block.";
const legacyGrokModerationEventPrefix = "participant.grok_moderation_block.";

export function getParticipantModerationEventType(senderFingerprint: string) {
  return `${participantModerationEventPrefix}${senderFingerprint}`;
}

export async function getParticipantModerationBlockCount(
  sessionId: string,
  senderFingerprint: string
) {
  return db.auditEvent.count({
    where: {
      sessionId,
      type: {
        in: [
          getParticipantModerationEventType(senderFingerprint),
          `${legacyVideoModerationEventPrefix}${senderFingerprint}`,
          `${legacyGrokModerationEventPrefix}${senderFingerprint}`
        ]
      }
    }
  });
}

export function isParticipantBanned(moderationBlockCount: number) {
  return moderationBlockCount >= participantModerationBanThreshold;
}

export function getParticipantBlocksRemaining(moderationBlockCount: number) {
  return Math.max(0, participantModerationBanThreshold - moderationBlockCount);
}
