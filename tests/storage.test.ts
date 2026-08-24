import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  extractVideoClosingFrameJpeg: vi.fn()
}));

vi.mock("@/lib/video-closing-frame", () => ({
  extractVideoClosingFrameJpeg: mocks.extractVideoClosingFrameJpeg
}));

describe("completed video persistence", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv("SUPABASE_URL", "https://storage.example.com");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
    vi.stubEnv("SUPABASE_STORAGE_BUCKET", "renders");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uploads a deterministic JPEG closing frame beside the MP4", async () => {
    mocks.extractVideoClosingFrameJpeg.mockResolvedValue(
      Buffer.from("closing-frame-jpeg")
    );
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 200
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { persistVideoAsset } = await import("@/lib/storage");

    await expect(
      persistVideoAsset("asset-123", Buffer.from("video-data"))
    ).resolves.toEqual({
      publicUrl:
        "https://storage.example.com/storage/v1/object/public/renders/asset-123.mp4",
      storagePath: "renders/asset-123.mp4",
      thumbnailUrl:
        "https://storage.example.com/storage/v1/object/public/renders/closing-frames/asset-123.jpg"
    });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://storage.example.com/storage/v1/object/renders/asset-123.mp4",
      "https://storage.example.com/storage/v1/object/renders/closing-frames/asset-123.jpg"
    ]);
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "image/jpeg",
          "x-upsert": "true"
        })
      })
    );
  });

  it("keeps the completed video usable when frame extraction fails", async () => {
    mocks.extractVideoClosingFrameJpeg.mockRejectedValue(
      new Error("unsupported codec")
    );
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 200
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { persistVideoAsset } = await import("@/lib/storage");

    await expect(
      persistVideoAsset("asset-legacy", Buffer.from("video-data"))
    ).resolves.toMatchObject({
      publicUrl:
        "https://storage.example.com/storage/v1/object/public/renders/asset-legacy.mp4",
      thumbnailUrl: null
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
