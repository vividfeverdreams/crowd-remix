import { describe, expect, it } from "vitest";
import {
  defaultVideoModelId,
  getVideoDurationForModelChange,
  getVideoDurationOptions,
  getVideoModelDefinition,
  isVideoModelDurationSupported,
  isVideoModelId,
  normalizeVideoDurationSecondsForModel,
  normalizeVideoModelId,
  videoModelDefinitions,
  videoModelIds
} from "@/lib/video-models";
import {
  defaultVideoDurationSeconds,
  formatVideoDuration,
  isVideoDurationSeconds,
  normalizeVideoDurationSeconds,
  videoDurationOptions
} from "@/lib/video-duration";

describe("video model capabilities", () => {
  it("publishes the supported Runway model IDs and duration ranges", () => {
    expect(videoModelIds).toEqual([
      "gemini_omni_flash",
      "seedance2",
      "seedance2_5",
      "hailuo3"
    ]);
    expect(videoModelDefinitions).toEqual([
      expect.objectContaining({
        id: "gemini_omni_flash",
        minDurationSeconds: 3,
        maxDurationSeconds: 10,
        defaultDurationSeconds: 8
      }),
      expect.objectContaining({
        id: "seedance2",
        minDurationSeconds: 4,
        maxDurationSeconds: 15,
        defaultDurationSeconds: 8
      }),
      expect.objectContaining({
        id: "seedance2_5",
        minDurationSeconds: 4,
        maxDurationSeconds: 30,
        defaultDurationSeconds: 8
      }),
      expect.objectContaining({
        id: "hailuo3",
        minDurationSeconds: 5,
        maxDurationSeconds: 15,
        defaultDurationSeconds: 8
      })
    ]);
  });

  it("guards, normalizes, and looks up model IDs", () => {
    expect(isVideoModelId("seedance2_5")).toBe(true);
    expect(isVideoModelId("unknown")).toBe(false);
    expect(normalizeVideoModelId("hailuo3")).toBe("hailuo3");
    expect(normalizeVideoModelId("unknown")).toBe(defaultVideoModelId);
    expect(getVideoModelDefinition("seedance2").label).toBe("Seedance 2.0");
    expect(getVideoModelDefinition("unknown")).toBeUndefined();
  });

  it.each([
    ["gemini_omni_flash", 3, 10],
    ["seedance2", 4, 15],
    ["seedance2_5", 4, 30],
    ["hailuo3", 5, 15]
  ] as const)(
    "generates every whole-second option for %s",
    (videoModel, firstDuration, lastDuration) => {
      const options = getVideoDurationOptions(videoModel);

      expect(options[0]).toBe(firstDuration);
      expect(options.at(-1)).toBe(lastDuration);
      expect(options).toHaveLength(lastDuration - firstDuration + 1);
      expect(options).toEqual(
        Array.from(
          { length: lastDuration - firstDuration + 1 },
          (_, index) => firstDuration + index
        )
      );
    }
  );

  it("validates model and duration as a pair", () => {
    expect(isVideoModelDurationSupported("hailuo3", 5)).toBe(true);
    expect(isVideoModelDurationSupported("hailuo3", 15)).toBe(true);
    expect(isVideoModelDurationSupported("hailuo3", 4)).toBe(false);
    expect(isVideoModelDurationSupported("hailuo3", 15.5)).toBe(false);
    expect(isVideoModelDurationSupported("unknown", 8)).toBe(false);
  });

  it("keeps a compatible duration when switching models", () => {
    expect(getVideoDurationForModelChange("seedance2_5", 12)).toBe(12);
    expect(normalizeVideoDurationSecondsForModel("hailuo3", 12)).toBe(12);
  });

  it("resets an incompatible duration to the new model's default instead of clamping", () => {
    expect(getVideoDurationForModelChange("gemini_omni_flash", 30)).toBe(8);
    expect(getVideoDurationForModelChange("hailuo3", 4)).toBe(8);
    expect(normalizeVideoDurationSecondsForModel("unknown", 30)).toBe(8);
  });
});

describe("legacy Omni duration helpers", () => {
  it("remain available and use Omni's current capabilities", () => {
    expect(videoDurationOptions).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
    expect(defaultVideoDurationSeconds).toBe(8);
    expect(isVideoDurationSeconds(3)).toBe(true);
    expect(isVideoDurationSeconds(11)).toBe(false);
    expect(normalizeVideoDurationSeconds(10)).toBe(10);
    expect(normalizeVideoDurationSeconds(30)).toBe(8);
    expect(formatVideoDuration(6)).toBe("6s");
  });
});
