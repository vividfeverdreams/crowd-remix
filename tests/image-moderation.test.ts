import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createModeration: vi.fn(),
  getOpenAiClient: vi.fn(),
  getEffectiveOpenAiApiKeyForUser: vi.fn()
}));

vi.mock("@/lib/openai-client", () => ({
  getOpenAiClient: mocks.getOpenAiClient
}));

vi.mock("@/lib/openai-key-store", () => ({
  getEffectiveOpenAiApiKeyForUser:
    mocks.getEffectiveOpenAiApiKeyForUser
}));

import {
  assessSubmissionImage,
  participantImageModerationBlockedReason
} from "@/lib/image-moderation";

describe("submission image moderation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEffectiveOpenAiApiKeyForUser.mockResolvedValue("test-key");
    mocks.getOpenAiClient.mockReturnValue({
      moderations: {
        create: mocks.createModeration
      }
    });
  });

  it("approves a photo when multimodal moderation reports no flags", async () => {
    mocks.createModeration.mockResolvedValue({
      results: [
        {
          flagged: false,
          categories: {
            sexual: false,
            violence: false
          }
        }
      ]
    });

    await expect(
      assessSubmissionImage({
        userId: "user-1",
        image: {
          data: Buffer.from([1, 2, 3]),
          mimeType: "image/jpeg"
        }
      })
    ).resolves.toEqual({
      decision: "approved",
      flags: [],
      explanation:
        "The attached image passed venue-safe multimodal moderation."
    });
  });

  it("rejects a sexual image with a moderation reason suitable for strike tracking", async () => {
    mocks.createModeration.mockResolvedValue({
      results: [
        {
          flagged: true,
          categories: {
            sexual: true,
            "violence/graphic": false
          }
        }
      ]
    });

    const assessment = await assessSubmissionImage({
      userId: "user-1",
      image: {
        data: Buffer.from([1, 2, 3]),
        mimeType: "image/jpeg"
      }
    });

    expect(assessment.decision).toBe("rejected");
    expect(assessment.flags).toEqual(["sexual"]);
    expect(assessment.explanation).toContain(
      participantImageModerationBlockedReason
    );
  });

  it("does not issue a strike when the moderation service is unavailable", async () => {
    mocks.getOpenAiClient.mockReturnValue(null);

    await expect(
      assessSubmissionImage({
        userId: "user-1",
        image: {
          data: Buffer.from([1, 2, 3]),
          mimeType: "image/jpeg"
        }
      })
    ).rejects.toThrow("temporarily unavailable");
  });
});
