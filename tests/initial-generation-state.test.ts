import { describe, expect, it } from "vitest";
import { getInitialGenerationPresentation } from "@/components/dashboard-shell";

describe("initial generation dashboard state", () => {
  it("surfaces a missing first-video job instead of silently hiding the error", () => {
    expect(
      getInitialGenerationPresentation({
        sessionStatus: "live",
        hasCurrentAsset: false,
        isStarting: false
      })
    ).toEqual({
      visible: true,
      failed: true,
      failureReason: "The first video job could not be created. Retry the generation."
    });
  });

  it("shows the provider failure reason for a failed seed", () => {
    expect(
      getInitialGenerationPresentation({
        sessionStatus: "live",
        hasCurrentAsset: false,
        isStarting: false,
        seedJob: {
          status: "failed",
          failureReason: "Gemini rejected the request."
        }
      })
    ).toEqual({
      visible: true,
      failed: true,
      failureReason: "Gemini rejected the request."
    });
  });

  it("keeps an active seed in the generating state", () => {
    expect(
      getInitialGenerationPresentation({
        sessionStatus: "live",
        hasCurrentAsset: false,
        isStarting: false,
        seedJob: {
          status: "in_progress",
          failureReason: null
        }
      })
    ).toEqual({
      visible: true,
      failed: false,
      failureReason: null
    });
  });

  it("hides the initial-generation card once playback has a current video", () => {
    expect(
      getInitialGenerationPresentation({
        sessionStatus: "live",
        hasCurrentAsset: true,
        isStarting: false,
        seedJob: {
          status: "completed",
          failureReason: null
        }
      }).visible
    ).toBe(false);
  });
});
