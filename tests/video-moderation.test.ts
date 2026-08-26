import { describe, expect, it } from "vitest";
import {
  getVideoModerationDiagnostic,
  getVideoModerationDiagnosticLabel,
  normalizeProviderFailureCode
} from "@/lib/video-moderation";

describe("video-provider moderation diagnostics", () => {
  it.each([
    ["SAFETY.INPUT.TEXT", "input_text"],
    ["SAFETY.INPUT.IMAGE", "input_image"],
    ["SAFETY.INPUT.VIDEO", "input_video"],
    ["SAFETY.INPUT", "input_media"],
    ["SAFETY.OUTPUT.VIDEO", "generated_output"],
    ["INPUT_PREPROCESSING.SAFETY.TEXT", "input_text"],
    ["SAFETY", "provider_safety"]
  ] as const)("maps %s to %s", (code, expected) => {
    expect(getVideoModerationDiagnostic(code)).toBe(expected);
  });

  it("does not present non-moderation codes as safety diagnostics", () => {
    expect(getVideoModerationDiagnostic("INTERNAL.BAD_OUTPUT")).toBeNull();
    expect(getVideoModerationDiagnostic(null)).toBeNull();
  });

  it("normalizes provider codes before persistence", () => {
    expect(normalizeProviderFailureCode("  SAFETY.INPUT.IMAGE  ")).toBe(
      "SAFETY.INPUT.IMAGE"
    );
    expect(normalizeProviderFailureCode(400)).toBe("400");
    expect(normalizeProviderFailureCode(undefined)).toBeNull();
  });

  it("uses provider-neutral, approximate public wording", () => {
    expect(getVideoModerationDiagnosticLabel("input_image")).toContain(
      "may have triggered"
    );
    expect(getVideoModerationDiagnosticLabel("generated_output")).toContain(
      "generated output"
    );
  });
});
