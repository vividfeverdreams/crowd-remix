import { describe, expect, it } from "vitest";
import {
  estimateVideoRenderProgress,
  maximumEstimatedVideoProgress,
  normalizeVideoProgress
} from "@/lib/render-progress";

describe("normalizeVideoProgress", () => {
  it("rounds and clamps the provider's reported percentage", () => {
    expect(normalizeVideoProgress(43.6)).toBe(44);
    expect(normalizeVideoProgress(-12)).toBe(0);
    expect(normalizeVideoProgress(108)).toBe(100);
  });

  it("keeps progress monotonic when a later poll reports a lower value", () => {
    expect(normalizeVideoProgress(39, 52)).toBe(52);
  });

  it("keeps the previous value when progress is missing or invalid", () => {
    expect(normalizeVideoProgress(undefined, 31)).toBe(31);
    expect(normalizeVideoProgress(Number.NaN, 31)).toBe(31);
  });
});

describe("estimateVideoRenderProgress", () => {
  const createdAt = new Date("2026-08-01T12:00:00.000Z");

  it("advances queued and in-progress estimates with elapsed time", () => {
    expect(
      estimateVideoRenderProgress({
        status: "queued",
        createdAt,
        now: createdAt.getTime()
      })
    ).toBe(5);
    expect(
      estimateVideoRenderProgress({
        status: "queued",
        createdAt,
        now: createdAt.getTime() + 15_000
      })
    ).toBe(13);
    expect(
      estimateVideoRenderProgress({
        status: "in_progress",
        createdAt,
        now: createdAt.getTime() + 60_000
      })
    ).toBe(58);
  });

  it("never regresses and never estimates completion", () => {
    expect(
      estimateVideoRenderProgress({
        status: "in_progress",
        createdAt,
        previousProgress: 80,
        now: createdAt.getTime() + 5_000
      })
    ).toBe(80);
    expect(
      estimateVideoRenderProgress({
        status: "in_progress",
        createdAt,
        now: createdAt.getTime() + 10 * 60_000
      })
    ).toBe(maximumEstimatedVideoProgress);
    expect(maximumEstimatedVideoProgress).toBeLessThan(100);
  });
});
