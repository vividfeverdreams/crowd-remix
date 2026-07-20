import { describe, expect, it } from "vitest";
import { publicSubmissionSchema, sessionFormSchema, sessionIdeaSchema, sessionPrefillSchema } from "@/lib/schemas";

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
  autoSelectEnabled: true
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
  it("accepts a detailed visual idea longer than the old 240-character limit", () => {
    const prompt = `Shift the whole visual world into a moonlit paper city with slow lanterns and soft shadows. ${"Add layered texture and gentle movement. ".repeat(6)}`;
    const result = publicSubmissionSchema.safeParse({ prompt });

    expect(prompt.length).toBeGreaterThan(240);
    expect(result.success).toBe(true);
  });

  it("still limits excessively long audience requests", () => {
    const result = publicSubmissionSchema.safeParse({ prompt: "x".repeat(601) });

    expect(result.success).toBe(false);
  });
});
