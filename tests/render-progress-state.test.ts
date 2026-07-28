import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {}
}));

import {
  getRenderProgressEventType,
  getStoredRenderProgress
} from "@/lib/render-progress-state";

describe("render progress session state", () => {
  it("uses a render-specific event key", () => {
    expect(getRenderProgressEventType("render-42")).toBe("render.progress.render-42");
  });

  it("reads and clamps the stored provider progress", () => {
    const events = [
      {
        type: "render.progress.render-42",
        details: "63.6"
      }
    ];

    expect(getStoredRenderProgress(events, "render-42")).toBe(64);
    expect(getStoredRenderProgress(events, "another-render")).toBeNull();
  });
});
