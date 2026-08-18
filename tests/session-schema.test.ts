import { describe, expect, it } from "vitest";
import {
  controlSchema,
  publicSubmissionSchema,
  sessionFormSchema,
  sessionIdeaSchema,
  sessionPrefillSchema
} from "@/lib/schemas";

const validSession = {
  name: "A",
  artistName: "M",
  trackName: "X",
  creativeBible: "Dreamlike",
  allowedMotifs: "Fog",
  bannedTerms: "None",
  colorPalette: "Blue",
  motionRules: "Slow",
  basePrompt: "A dream",
  imageReferenceUrl: "",
  smsNumber: "",
  venueSafeMode: true,
  artistControlEnabled: true,
  autoSelectEnabled: true,
  videoModel: "gemini_omni_flash" as const,
  videoDurationSeconds: 8,
  submissionRateLimitEnabled: false,
  submissionRateLimitCount: 3
};

describe("sessionFormSchema", () => {
  it("accepts concise session details and normalizes blank optional fields", () => {
    const result = sessionFormSchema.safeParse(validSession);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.artistName).toBe("M");
      expect(result.data.trackName).toBe("X");
      expect(result.data.imageReferenceUrl).toBeUndefined();
      expect(result.data.smsNumber).toBeUndefined();
    }
  });

  it("returns an actionable error for a missing required field", () => {
    const result = sessionFormSchema.safeParse({
      ...validSession,
      basePrompt: "   "
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("Base prompt is required.");
    }
  });

  it("returns an actionable error for an invalid optional URL", () => {
    const result = sessionFormSchema.safeParse({
      ...validSession,
      imageReferenceUrl: "not-a-url"
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("Enter a valid image reference URL.");
    }
  });

  it("accepts an empty allowed-motifs list when the creation toggle is off", () => {
    const result = sessionFormSchema.safeParse({
      ...validSession,
      allowedMotifs: ""
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.allowedMotifs).toBe("");
    }
  });

  it("accepts artist control being disabled for raw crowd prompts", () => {
    const result = sessionFormSchema.safeParse({
      ...validSession,
      artistControlEnabled: false
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.artistControlEnabled).toBe(false);
    }
  });

  it("accepts a supported custom video length", () => {
    const result = sessionFormSchema.safeParse({
      ...validSession,
      videoDurationSeconds: 6
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.videoDurationSeconds).toBe(6);
    }
  });

  it("accepts a model and duration supported by that model", () => {
    const result = sessionFormSchema.safeParse({
      ...validSession,
      videoModel: "seedance2_5",
      videoDurationSeconds: 30
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.videoModel).toBe("seedance2_5");
      expect(result.data.videoDurationSeconds).toBe(30);
    }
  });

  it("keeps existing clients on Omni at the eight-second default", () => {
    const {
      videoModel: _videoModel,
      videoDurationSeconds: _videoDurationSeconds,
      ...legacySession
    } = validSession;
    const result = sessionFormSchema.safeParse(legacySession);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.videoModel).toBe("gemini_omni_flash");
      expect(result.data.videoDurationSeconds).toBe(8);
    }
  });

  it("rejects a video length outside the selected model's range", () => {
    const result = sessionFormSchema.safeParse({
      ...validSession,
      videoModel: "seedance2",
      videoDurationSeconds: 16
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]).toMatchObject({
        message: "Video length must be between 4 and 15 seconds for Seedance 2.0.",
        path: ["videoDurationSeconds"]
      });
    }
  });

  it("rejects an unknown video model", () => {
    const result = sessionFormSchema.safeParse({
      ...validSession,
      videoModel: "future-model"
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["videoModel"]);
    }
  });

  it("keeps artist control on by default for existing clients", () => {
    const { artistControlEnabled: _artistControlEnabled, ...legacySession } = validSession;
    const result = sessionFormSchema.safeParse(legacySession);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.artistControlEnabled).toBe(true);
    }
  });

  it("keeps the device submission limit off by default", () => {
    const {
      submissionRateLimitEnabled: _submissionRateLimitEnabled,
      submissionRateLimitCount: _submissionRateLimitCount,
      ...legacySession
    } = validSession;
    const result = sessionFormSchema.safeParse(legacySession);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.submissionRateLimitEnabled).toBe(false);
      expect(result.data.submissionRateLimitCount).toBe(3);
    }
  });

  it("accepts a configurable ten-minute device submission limit", () => {
    const result = sessionFormSchema.safeParse({
      ...validSession,
      submissionRateLimitEnabled: true,
      submissionRateLimitCount: 7
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.submissionRateLimitEnabled).toBe(true);
      expect(result.data.submissionRateLimitCount).toBe(7);
    }
  });

  it("rejects an invalid device submission limit", () => {
    const result = sessionFormSchema.safeParse({
      ...validSession,
      submissionRateLimitEnabled: true,
      submissionRateLimitCount: 0
    });

    expect(result.success).toBe(false);
  });
});

describe("sessionIdeaSchema", () => {
  it("accepts and trims a plain-English session idea", () => {
    const result = sessionIdeaSchema.safeParse({ idea: "  Blue fog with slow camera movement.  " });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.idea).toBe("Blue fog with slow camera movement.");
    }
  });

  it("asks for more detail when the idea is too short", () => {
    const result = sessionIdeaSchema.safeParse({ idea: "AI" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("Tell us a little more about the session you want to create.");
    }
  });
});

describe("sessionPrefillSchema", () => {
  it("accepts an AI draft containing every editable creative field", () => {
    const result = sessionPrefillSchema.safeParse({
      name: validSession.name,
      artistName: validSession.artistName,
      trackName: validSession.trackName,
      creativeBible: validSession.creativeBible,
      allowedMotifs: validSession.allowedMotifs,
      bannedTerms: validSession.bannedTerms,
      colorPalette: validSession.colorPalette,
      motionRules: validSession.motionRules,
      basePrompt: validSession.basePrompt
    });

    expect(result.success).toBe(true);
  });

  it("rejects a draft that omits a required answer", () => {
    const result = sessionPrefillSchema.safeParse({
      name: validSession.name,
      artistName: validSession.artistName,
      trackName: validSession.trackName,
      creativeBible: validSession.creativeBible,
      allowedMotifs: validSession.allowedMotifs,
      bannedTerms: validSession.bannedTerms,
      colorPalette: validSession.colorPalette,
      motionRules: validSession.motionRules
    });

    expect(result.success).toBe(false);
  });
});

describe("publicSubmissionSchema", () => {
  it("accepts a catalog statement and tied response selection", () => {
    const result = publicSubmissionSchema.safeParse({
      templateId: "choice-style",
      responseId: "choice-style-1-1",
      senderLabel: "Neon Shark",
      participantToken: "device-token-1234567890"
    });

    expect(result.success).toBe(true);
  });

  it("accepts an image statement without a response id", () => {
    const result = publicSubmissionSchema.safeParse({
      templateId: "image-environment",
      responseId: "",
      senderLabel: "Neon Shark",
      participantToken: "device-token-1234567890"
    });

    expect(result.success).toBe(true);
  });

  it("does not accept an arbitrary free-text prompt in place of a catalog id", () => {
    const result = publicSubmissionSchema.safeParse({
      prompt: "Make the water glow",
      senderLabel: "Neon Shark",
      participantToken: "device-token-1234567890"
    });

    expect(result.success).toBe(false);
  });

  it("requires a screen-safe nickname and persistent device token", () => {
    expect(
      publicSubmissionSchema.safeParse({
        templateId: "choice-style",
        responseId: "choice-style-1-1",
        senderLabel: "Neon Shark",
        participantToken: "device-token-1234567890"
      }).success
    ).toBe(true);
    expect(
      publicSubmissionSchema.safeParse({
        templateId: "choice-style",
        responseId: "choice-style-1-1",
        senderLabel: "<script>",
        participantToken: "short"
      }).success
    ).toBe(false);
  });
});

describe("controlSchema", () => {
  it("accepts every wordmark display control", () => {
    expect(
      controlSchema.safeParse({
        action: "set-wordmark-overlay",
        value: true
      }).success
    ).toBe(true);
    expect(
      controlSchema.safeParse({
        action: "set-wordmark-opacity",
        value: 0.55
      }).success
    ).toBe(true);
    expect(
      controlSchema.safeParse({
        action: "set-wordmark-size",
        value: 1.2
      }).success
    ).toBe(true);
    expect(
      controlSchema.safeParse({
        action: "set-wordmark-audio-reactive-only",
        value: true
      }).success
    ).toBe(true);
    expect(
      controlSchema.safeParse({
        action: "set-progress-overlay",
        value: true
      }).success
    ).toBe(true);
  });

  it("rejects out-of-range wordmark opacity", () => {
    expect(
      controlSchema.safeParse({
        action: "set-wordmark-opacity",
        value: 1.1
      }).success
    ).toBe(false);
  });

  it("rejects out-of-range wordmark size", () => {
    expect(
      controlSchema.safeParse({
        action: "set-wordmark-size",
        value: 1.6
      }).success
    ).toBe(false);
  });
});
