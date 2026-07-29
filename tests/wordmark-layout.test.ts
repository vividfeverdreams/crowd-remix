import { describe, expect, it } from "vitest";
import { wordmarkCropLayout, wordmarkSourceBounds } from "@/lib/wordmark-layout";

describe("wordmark crop layout", () => {
  it("maps the visible alpha bounds exactly to the cropped frame", () => {
    const horizontalStart =
      Number.parseFloat(wordmarkCropLayout.imageLeft) +
      (wordmarkSourceBounds.left / wordmarkCropLayout.visibleWidth) * 100;
    const horizontalEnd =
      Number.parseFloat(wordmarkCropLayout.imageLeft) +
      (wordmarkSourceBounds.right / wordmarkCropLayout.visibleWidth) * 100;
    const verticalStart =
      Number.parseFloat(wordmarkCropLayout.imageTop) +
      (wordmarkSourceBounds.top / wordmarkCropLayout.visibleHeight) * 100;
    const verticalEnd =
      Number.parseFloat(wordmarkCropLayout.imageTop) +
      (wordmarkSourceBounds.bottom / wordmarkCropLayout.visibleHeight) * 100;

    expect(horizontalStart).toBeCloseTo(0, 2);
    expect(horizontalEnd).toBeCloseTo(100, 2);
    expect(verticalStart).toBeCloseTo(0, 2);
    expect(verticalEnd).toBeCloseTo(100, 2);
  });

  it("uses the measured visible wordmark aspect ratio", () => {
    expect(wordmarkCropLayout.visibleWidth).toBe(2508);
    expect(wordmarkCropLayout.visibleHeight).toBe(1532);
    expect(wordmarkCropLayout.visibleWidth / wordmarkCropLayout.visibleHeight).toBeCloseTo(1.637, 3);
  });
});
