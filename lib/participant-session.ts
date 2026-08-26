import { db } from "@/lib/db";

export const participantModerationBanThreshold = 3;
export const participantImageModerationEventSummary =
  "Counted a participant image-moderation block";
const participantInputModerationEventPrefix =
  "participant.input_moderation_block.";
const legacyMediaModerationEventPrefix =
  "participant.media_moderation_block.";

export function getParticipantModerationEventType(senderFingerprint: string) {
  return `${participantInputModerationEventPrefix}${senderFingerprint}`;
}

export async function getParticipantModerationBlockCount(
  sessionId: string,
  senderFingerprint: string
) {
  return db.auditEvent.count({
    where: {
      sessionId,
      OR: [
        {
          type: getParticipantModerationEventType(senderFingerprint)
        },
        {
          type: `${legacyMediaModerationEventPrefix}${senderFingerprint}`,
          summary: participantImageModerationEventSummary
        }
      ]
    }
  });
}

export function isParticipantBanned(moderationBlockCount: number) {
  return moderationBlockCount >= participantModerationBanThreshold;
}

export function getParticipantBlocksRemaining(moderationBlockCount: number) {
  return Math.max(0, participantModerationBanThreshold - moderationBlockCount);
}
