import { describe, expect, it } from "vitest";
import { normalizeVideoProgress } from "@/lib/render-progress";

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
