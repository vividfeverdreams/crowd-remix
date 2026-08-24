import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const firstRetainedFrame = {
    id: "first-retained-frame",
    free: vi.fn()
  };
  const closingRetainedFrame = {
    id: "closing-retained-frame",
    free: vi.fn()
  };
  const firstFrame = {
    clone: vi.fn(() => firstRetainedFrame),
    free: vi.fn()
  };
  const closingFrame = {
    clone: vi.fn(() => closingRetainedFrame),
    free: vi.fn()
  };
  const input = {
    video: vi.fn(() => ({
      index: 2
    })),
    packets: vi.fn(async function* () {
      yield {
        streamIndex: 2
      };
      yield null;
    }),
    close: vi.fn()
  };
  const decoder = {
    frames: vi.fn(async function* () {
      yield firstFrame;
      yield closingFrame;
      yield null;
    }),
    close: vi.fn()
  };
  const scaler = {
    toJpeg: vi.fn(async () => Buffer.from("closing-jpeg")),
    dispose: vi.fn()
  };

  return {
    closingFrame,
    closingRetainedFrame,
    decoder,
    firstFrame,
    firstRetainedFrame,
    input,
    scaler,
    decoderCreate: vi.fn(async () => decoder),
    demuxerOpen: vi.fn(async () => input)
  };
});

vi.mock("node-av/api", () => ({
  Decoder: {
    create: mocks.decoderCreate
  },
  Demuxer: {
    open: mocks.demuxerOpen
  },
  Scaler: class {
    toJpeg = mocks.scaler.toJpeg;

    [Symbol.dispose]() {
      mocks.scaler.dispose();
    }
  }
}));

import { extractVideoClosingFrameJpeg } from "@/lib/video-closing-frame";

describe("video closing-frame extraction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("flushes the decoder and encodes only the final decoded frame", async () => {
    await expect(
      extractVideoClosingFrameJpeg(Buffer.from("short-mp4"))
    ).resolves.toEqual(Buffer.from("closing-jpeg"));

    expect(mocks.input.packets).toHaveBeenCalledWith(2);
    expect(mocks.firstFrame.free).toHaveBeenCalledTimes(1);
    expect(mocks.closingFrame.free).toHaveBeenCalledTimes(1);
    expect(mocks.firstRetainedFrame.free).toHaveBeenCalledTimes(1);
    expect(mocks.scaler.toJpeg).toHaveBeenCalledWith(
      mocks.closingRetainedFrame,
      {
        quality: 90
      }
    );
    expect(mocks.closingRetainedFrame.free).toHaveBeenCalledTimes(1);
    expect(mocks.scaler.dispose).toHaveBeenCalledTimes(1);
    expect(mocks.decoder.close).toHaveBeenCalledTimes(1);
    expect(mocks.input.close).toHaveBeenCalledTimes(1);
  });

  it("rejects empty video data before loading the native decoder", async () => {
    await expect(extractVideoClosingFrameJpeg(Buffer.alloc(0))).rejects.toThrow(
      "Cannot extract a closing frame from an empty video."
    );
    expect(mocks.demuxerOpen).not.toHaveBeenCalled();
  });
});
