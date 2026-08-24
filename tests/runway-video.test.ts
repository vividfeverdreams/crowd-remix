import { Buffer } from "node:buffer";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  downloadRunwayVideo,
  isRetryableRunwayError,
  isRunwayModerationError,
  isSafeToRetryRunwayStartError,
  retrieveRunwayTask,
  RunwayApiError,
  startRunwayVideoRender
} from "@/lib/runway-video";
import { providerOpeningFrameContinuityRequirement } from "@/lib/video-prompt-budget";

const taskId = "497f6eca-6276-4993-bfeb-53cbbbba6f08";
const apiKey = "test-runway-key";

function taskCreatedResponse() {
  return new Response(
    JSON.stringify({
      id: taskId,
      estimatedCost: {
        credits: 80
      }
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    }
  );
}

describe("Runway video adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("starts a text-to-video task with the required Runway headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(taskCreatedResponse());
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      startRunwayVideoRender({
        mode: "seed",
        prompt: "Slow liquid chrome waves",
        apiKey,
        durationSeconds: 6,
        model: "gemini_omni_flash"
      })
    ).resolves.toEqual({
      requestId: taskId,
      strategy: "runway_text_to_video"
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.dev.runwayml.com/v1/text_to_video"
    );

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;

    expect(request).toEqual(
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "X-Runway-Version": "2024-11-06"
        })
      })
    );
    expect(request.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(request.body))).toEqual({
      model: "gemini_omni_flash",
      promptText: "Slow liquid chrome waves",
      ratio: "1280:720",
      duration: 6
    });
  });

  it("starts image-to-video with the image as promptImage", async () => {
    const fetchMock = vi.fn().mockResolvedValue(taskCreatedResponse());
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      startRunwayVideoRender({
        mode: "seed",
        prompt: "The portrait wakes up",
        imageReferenceUrl: "https://example.com/portrait.jpg",
        apiKey,
        durationSeconds: 4
      })
    ).resolves.toEqual({
      requestId: taskId,
      strategy: "runway_image_to_video"
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.dev.runwayml.com/v1/image_to_video"
    );

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;

    expect(JSON.parse(String(request.body))).toEqual({
      model: "gemini_omni_flash",
      promptImage: "https://example.com/portrait.jpg",
      promptText: "The portrait wakes up",
      ratio: "1280:720",
      duration: 4
    });
  });

  it("starts video-to-video with an optional keyframe reference", async () => {
    const fetchMock = vi.fn().mockResolvedValue(taskCreatedResponse());
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      startRunwayVideoRender({
        mode: "remix",
        prompt: "Replace the room with an ultraviolet cathedral",
        sourceVideoUrl: "https://example.com/source.mp4",
        remixReferenceImageUrl: "https://example.com/keyframe.jpg",
        apiKey,
        durationSeconds: 10
      })
    ).resolves.toEqual({
      requestId: taskId,
      strategy: "runway_video_to_video"
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.dev.runwayml.com/v1/video_to_video"
    );

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body));

    expect(body).toEqual({
      model: "gemini_omni_flash",
      videoUri: "https://example.com/source.mp4",
      promptText: "Replace the room with an ultraviolet cathedral",
      references: [
        {
          uri: "https://example.com/keyframe.jpg"
        }
      ]
    });
    expect(body).not.toHaveProperty("duration");
    expect(body).not.toHaveProperty("ratio");
    expect(body.references[0]).not.toHaveProperty("type");
  });

  it("orders the prior closing frame before the crowd reference image", async () => {
    const fetchMock = vi.fn().mockResolvedValue(taskCreatedResponse());
    vi.stubGlobal("fetch", fetchMock);
    const prompt = `${providerOpeningFrameContinuityRequirement} Evolve into an ultraviolet cathedral.`;

    await startRunwayVideoRender({
      mode: "remix",
      prompt,
      sourceVideoUrl: "https://example.com/source.mp4",
      openingFrameImageUrl: "https://example.com/closing-frame.jpg",
      remixReferenceImageUrl: "https://example.com/crowd-photo.jpg",
      apiKey,
      durationSeconds: 10
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body));

    expect(body.promptText.startsWith(providerOpeningFrameContinuityRequirement)).toBe(
      true
    );
    expect(body.references).toEqual([
      {
        uri: "https://example.com/closing-frame.jpg"
      },
      {
        uri: "https://example.com/crowd-photo.jpg"
      }
    ]);
  });

  it("clamps overlong prompts and uses the default model duration", async () => {
    const fetchMock = vi.fn().mockResolvedValue(taskCreatedResponse());
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      startRunwayVideoRender({
        mode: "seed",
        prompt: "x".repeat(1_001),
        apiKey
      })
    ).resolves.toEqual({
      requestId: taskId,
      strategy: "runway_text_to_video"
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body));

    expect(body.promptText).toHaveLength(1_000);
    expect(body.duration).toBe(8);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      name: "Seedance 2.0 text-to-video at its maximum duration",
      model: "seedance2",
      durationSeconds: 15,
      imageReferenceUrl: null,
      endpoint: "text_to_video",
      expectedBody: {
        model: "seedance2",
        promptText: "Turn the stage into a moonlit ocean",
        ratio: "1280:720",
        duration: 15,
        audio: false
      }
    },
    {
      name: "Seedance 2.5 image-to-video at its maximum duration",
      model: "seedance2_5",
      durationSeconds: 30,
      imageReferenceUrl: "https://example.com/seedance-reference.jpg",
      endpoint: "image_to_video",
      expectedBody: {
        model: "seedance2_5",
        promptImage: "https://example.com/seedance-reference.jpg",
        promptText: "Turn the stage into a moonlit ocean",
        ratio: "1280:720",
        duration: 30,
        audio: false
      }
    },
    {
      name: "Hailuo 3 text-to-video at its minimum duration",
      model: "hailuo3",
      durationSeconds: 5,
      imageReferenceUrl: null,
      endpoint: "text_to_video",
      expectedBody: {
        model: "hailuo3",
        promptText: "Turn the stage into a moonlit ocean",
        ratio: "16:9",
        resolution: "768P",
        duration: 5
      }
    }
  ])("starts $name with the model-specific request body", async (testCase) => {
    const fetchMock = vi.fn().mockResolvedValue(taskCreatedResponse());
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      startRunwayVideoRender({
        mode: "seed",
        prompt: "Turn the stage into a moonlit ocean",
        imageReferenceUrl: testCase.imageReferenceUrl,
        apiKey,
        durationSeconds: testCase.durationSeconds,
        model: testCase.model
      })
    ).resolves.toEqual({
      requestId: taskId,
      strategy:
        testCase.endpoint === "image_to_video"
          ? "runway_image_to_video"
          : "runway_text_to_video"
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `https://api.dev.runwayml.com/v1/${testCase.endpoint}`
    );

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;

    expect(JSON.parse(String(request.body))).toEqual(testCase.expectedBody);
  });

  it.each([
    {
      name: "Seedance 2.0 at its minimum duration",
      model: "seedance2",
      durationSeconds: 4,
      expectedBody: {
        model: "seedance2",
        promptVideo: "https://example.com/source.mp4",
        promptText: "Make the dancers trail ribbons of neon",
        duration: 4,
        ratio: "1280:720",
        audio: false,
        references: [
          {
            uri: "https://example.com/keyframe.jpg"
          }
        ]
      }
    },
    {
      name: "Seedance 2.5 at its minimum duration",
      model: "seedance2_5",
      durationSeconds: 4,
      expectedBody: {
        model: "seedance2_5",
        promptVideo: "https://example.com/source.mp4",
        promptText: "Make the dancers trail ribbons of neon",
        duration: 4,
        ratio: "1280:720",
        audio: false,
        mode: "reference",
        references: [
          {
            uri: "https://example.com/keyframe.jpg"
          }
        ]
      }
    },
    {
      name: "Hailuo 3 at its maximum duration",
      model: "hailuo3",
      durationSeconds: 15,
      expectedBody: {
        model: "hailuo3",
        promptVideo: "https://example.com/source.mp4",
        promptText: "Make the dancers trail ribbons of neon",
        duration: 15,
        ratio: "16:9",
        resolution: "768P",
        references: [
          {
            uri: "https://example.com/keyframe.jpg"
          }
        ]
      }
    }
  ])("starts video-to-video with $name", async (testCase) => {
    const fetchMock = vi.fn().mockResolvedValue(taskCreatedResponse());
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      startRunwayVideoRender({
        mode: "remix",
        prompt: "Make the dancers trail ribbons of neon",
        sourceVideoUrl: "https://example.com/source.mp4",
        remixReferenceImageUrl: "https://example.com/keyframe.jpg",
        apiKey,
        durationSeconds: testCase.durationSeconds,
        model: testCase.model
      })
    ).resolves.toEqual({
      requestId: taskId,
      strategy: "runway_video_to_video"
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.dev.runwayml.com/v1/video_to_video"
    );

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;

    expect(JSON.parse(String(request.body))).toEqual(testCase.expectedBody);
  });

  it.each([
    { model: "gemini_omni_flash", durationSeconds: 2 },
    { model: "gemini_omni_flash", durationSeconds: 11 },
    { model: "seedance2", durationSeconds: 3 },
    { model: "seedance2", durationSeconds: 4.5 },
    { model: "seedance2_5", durationSeconds: 31 },
    { model: "hailuo3", durationSeconds: 4 }
  ])(
    "rejects $model duration $durationSeconds before calling Runway",
    async ({ model, durationSeconds }) => {
      const fetchMock = vi.fn().mockResolvedValue(taskCreatedResponse());
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        startRunwayVideoRender({
          mode: "seed",
          prompt: "A valid prompt",
          apiKey,
          durationSeconds,
          model
        })
      ).rejects.toMatchObject({
        name: "RunwayApiError",
        code: "INVALID_DURATION",
        status: 0,
        operation: "validation"
      });

      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it("rejects unknown models before calling Runway", async () => {
    const fetchMock = vi.fn().mockResolvedValue(taskCreatedResponse());
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      startRunwayVideoRender({
        mode: "seed",
        prompt: "A valid prompt",
        apiKey,
        durationSeconds: 8,
        model: "not-a-runway-video-model"
      })
    ).rejects.toMatchObject({
      name: "RunwayApiError",
      code: "UNSUPPORTED_MODEL",
      status: 0,
      operation: "validation"
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retrieves and validates a succeeded task", async () => {
    const outputUrl = "https://example.com/generated.mp4";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: taskId,
          status: "SUCCEEDED",
          createdAt: "2026-08-03T12:00:00.000Z",
          output: [outputUrl],
          cost: {
            credits: 80
          }
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(retrieveRunwayTask(taskId, apiKey)).resolves.toEqual({
      id: taskId,
      status: "SUCCEEDED",
      createdAt: "2026-08-03T12:00:00.000Z",
      output: [outputUrl],
      cost: {
        credits: 80
      }
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `https://api.dev.runwayml.com/v1/tasks/${taskId}`
    );

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;

    expect(request).toEqual(
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
          "X-Runway-Version": "2024-11-06"
        })
      })
    );
  });

  it("preserves failed-task details for moderation and retry decisions", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: taskId,
          status: "FAILED",
          createdAt: "2026-08-03T12:00:00.000Z",
          failure: "The input image was rejected.",
          failureCode: "SAFETY.INPUT.IMAGE",
          cost: {
            credits: 80
          }
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const task = await retrieveRunwayTask(taskId, apiKey);

    expect(task).toMatchObject({
      status: "FAILED",
      failure: "The input image was rejected.",
      failureCode: "SAFETY.INPUT.IMAGE"
    });
    expect(isRunwayModerationError(task)).toBe(true);
    expect(isRetryableRunwayError(task)).toBe(false);
  });

  it("returns typed HTTP errors with retry metadata", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Generation limit reached." }), {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": "2"
        }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const error = await startRunwayVideoRender({
      mode: "seed",
      prompt: "A crystalline forest",
      apiKey
    }).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(RunwayApiError);
    expect(error).toMatchObject({
      status: 429,
      code: "HTTP_429",
      operation: "start",
      retryAfterMs: 2_000
    });
    expect(String(error)).toContain("Generation limit reached.");
    expect(isRetryableRunwayError(error)).toBe(true);
    expect(isSafeToRetryRunwayStartError(error)).toBe(true);
  });

  it("does not classify an ambiguous start network failure as start-safe", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new TypeError(`Connection lost for ${apiKey}`));
    vi.stubGlobal("fetch", fetchMock);

    const error = await startRunwayVideoRender({
      mode: "seed",
      prompt: "A crystalline forest",
      apiKey
    }).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(RunwayApiError);
    expect(error).toMatchObject({
      status: 0,
      code: "NETWORK_ERROR",
      operation: "start"
    });
    expect(String(error)).not.toContain(apiKey);
    expect(String(error)).toContain("[REDACTED]");
    expect(isRetryableRunwayError(error)).toBe(true);
    expect(isSafeToRetryRunwayStartError(error)).toBe(false);
  });

  it("downloads a completed video without forwarding the API key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: {
          "Content-Type": "video/mp4"
        }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const buffer = await downloadRunwayVideo(
      "https://example.com/signed-output.mp4"
    );

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect([...buffer]).toEqual([1, 2, 3, 4]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://example.com/signed-output.mp4"
    );

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;

    expect(request.method).toBe("GET");
    expect(request.headers).toBeUndefined();
    expect(request.signal).toBeInstanceOf(AbortSignal);
  });
});
