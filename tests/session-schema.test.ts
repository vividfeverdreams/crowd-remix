import { describe, expect, it } from "vitest";
import { sessionFormSchema } from "@/lib/schemas";

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
});
