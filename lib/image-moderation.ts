import { env } from "@/lib/env";
import { getOpenAiClient } from "@/lib/openai-client";
import { getEffectiveOpenAiApiKeyForUser } from "@/lib/openai-key-store";
import type { ValidatedSubmissionImage } from "@/lib/submission-image";

export const participantImageModerationBlockedReason =
  "The attached image was blocked by venue-safe image moderation.";

export type ImageModerationAssessment = {
  decision: "approved" | "rejected";
  flags: string[];
  explanation: string;
};

export async function assessSubmissionImage(input: {
  image: ValidatedSubmissionImage;
  userId: string;
}): Promise<ImageModerationAssessment> {
  const apiKey =
    (await getEffectiveOpenAiApiKeyForUser(input.userId)) ||
    env.openAiApiKey ||
    null;
  const client = getOpenAiClient(apiKey);

  if (!client) {
    throw new Error(
      "Image moderation is temporarily unavailable. Try submitting again without a photo."
    );
  }

  try {
    const response = await client.moderations.create({
      model: "omni-moderation-latest",
      input: [
        {
          type: "image_url",
          image_url: {
            url: `data:${input.image.mimeType};base64,${input.image.data.toString("base64")}`
          }
        }
      ]
    });
    const result = response.results[0];

    if (!result) {
      throw new Error("Image moderation returned no result.");
    }

    const flags = Object.entries(result.categories)
      .filter(([, blocked]) => blocked === true)
      .map(([category]) => category);

    return {
      decision: result.flagged ? "rejected" : "approved",
      flags,
      explanation: result.flagged
        ? `${participantImageModerationBlockedReason} Categories: ${flags.join(", ") || "unsafe-content"}.`
        : "The attached image passed venue-safe multimodal moderation."
    };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith(participantImageModerationBlockedReason)
    ) {
      throw error;
    }

    throw new Error(
      "Image moderation could not finish. Try submitting again without a photo."
    );
  }
}

export function isImageModerationFailureReason(
  reason: string | null | undefined
) {
  return Boolean(
    reason?.startsWith(participantImageModerationBlockedReason)
  );
}
