import { afterEach, describe, expect, it, vi } from "vitest";

const testDoubles = vi.hoisted(() => {
  const transaction = {
    promptSubmission: {
      update: vi.fn()
    },
    renderJob: {
      update: vi.fn(),
      updateMany: vi.fn(async () => ({
        count: 1
      }))
    },
    visualAsset: {
      update: vi.fn()
    },
    playbackState: {
      updateMany: vi.fn()
    }
  };

  return {
    db: {
      auditEvent: {
        count: vi.fn()
      },
      renderJob: {
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(async () => ({
          count: 1
        })),
        count: vi.fn()
      },
      $transaction: vi.fn(async (callback: (tx: typeof transaction) => unknown) =>
        callback(transaction)
      )
    },
    getEffectiveGeminiApiKeyForUser: vi.fn(),
    persistVideoAsset: vi.fn(),
    promoteOldestReadyAsset: vi.fn(),
    recordAuditEvent: vi.fn(),
    transaction
  };
});

vi.mock("@/lib/db", () => ({
  db: testDoubles.db
}));

vi.mock("@/lib/audit", () => ({
  recordAuditEvent: testDoubles.recordAuditEvent
}));

vi.mock("@/lib/playback-queue", () => ({
  promoteOldestReadyAsset: testDoubles.promoteOldestReadyAsset
}));

vi.mock("@/lib/storage", () => ({
  getDemoLoopUrl: () => "https://example.com/demo.mp4",
  persistVideoAsset: testDoubles.persistVideoAsset
}));

vi.mock("@/lib/google-key-store", () => ({
  getEffectiveGeminiApiKeyForUser: testDoubles.getEffectiveGeminiApiKeyForUser
}));

import {
  completeGeminiVideoRender,
  failRenderJob,
  isVideoModerationError,
  reconcileRenderJob,
  startVideoRender,
  videoModerationBlockedReason
} from "@/lib/rendering";

describe("Gemini Omni video requests", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("keeps the demo fallback active until a Gemini key is configured", async () => {
    await expect(
      startVideoRender({
        mode: "seed",
        prompt: "Slow liquid chrome waves"
      })
    ).resolves.toEqual({
      kind: "demo",
      videoId: expect.stringMatching(/^demo_\d+$/),
      publicUrl: "https://example.com/demo.mp4",
      storagePath: null
    });
  });

  it("never falls back to text-to-video for a remix without a source video", async () => {
    await expect(
      startVideoRender({
        mode: "remix",
        prompt: "Turn the clouds into stained glass",
        geminiApiKey: "test-gemini-key"
      })
    ).rejects.toThrow("requires a completed source video");
  });

  it.each([4, 6, 8])(
    "starts a background image-to-video seed generation at %s seconds",
    async (durationSeconds) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: {
            "Content-Type": "image/png"
          }
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "v1_seed-request",
            status: "queued"
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

    await expect(
      startVideoRender({
        mode: "seed",
        prompt: "Slow liquid chrome waves",
        imageReferenceUrl: "https://example.com/reference.png",
        geminiApiKey: "test-gemini-key",
        durationSeconds
      })
    ).resolves.toEqual({
      kind: "live",
      requestId: "v1_seed-request",
      outputUri: null,
      strategy: "seed"
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://example.com/reference.png");
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://generativelanguage.googleapis.com/v1beta/interactions"
    );

    const request = fetchMock.mock.calls[1]?.[1] as RequestInit;

    expect(request).toEqual(
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-goog-api-key": "test-gemini-key",
          "Content-Type": "application/json",
          "Api-Revision": "2026-05-20"
        })
      })
    );

    expect(JSON.parse(String(request.body))).toMatchObject({
      model: "gemini-omni-flash-preview",
      background: true,
      store: true,
      stream: false,
      input: [
        {
          type: "image",
          data: "AQID",
          mime_type: "image/png"
        },
        {
          type: "text",
          text: "Slow liquid chrome waves"
        }
      ],
      response_format: {
        type: "video",
        delivery: "uri",
        duration: `${durationSeconds}s`,
        aspect_ratio: "16:9"
      },
      generation_config: {
        video_config: {
          task: "image_to_video"
        }
      }
    });
  });

  it("uses Omni's stateful video-editing chain for generated source videos", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "v1_edit-request",
            status: "completed",
            output_video: {
              type: "video",
              uri: "https://generativelanguage.googleapis.com/v1beta/files/edit-output:download?alt=media"
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

    await expect(
      startVideoRender({
        mode: "remix",
        prompt: "Add ultraviolet lightning",
        sourceVideoId: "v1_source-interaction",
        sourceVideoUrl: "https://example.com/source.mp4",
        geminiApiKey: "test-gemini-key"
      })
    ).resolves.toEqual({
      kind: "live",
      requestId: "v1_edit-request",
      outputUri:
        "https://generativelanguage.googleapis.com/v1beta/files/edit-output:download?alt=media",
      strategy: "stateful_edit"
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;

    expect(JSON.parse(String(request.body))).toMatchObject({
      model: "gemini-omni-flash-preview",
      background: true,
      previous_interaction_id: "v1_source-interaction",
      input: "Add ultraviolet lightning"
    });
    expect(JSON.parse(String(request.body)).response_format).not.toHaveProperty(
      "aspect_ratio"
    );
    expect(JSON.parse(String(request.body)).response_format).not.toHaveProperty(
      "duration"
    );
    expect(JSON.parse(String(request.body))).not.toHaveProperty(
      "generation_config"
    );
  });

  it("adds an approved crowd photo as an Omni remix reference", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(new Uint8Array([7, 8, 9]), {
          status: 200,
          headers: {
            "Content-Type": "image/jpeg"
          }
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "v1_image-guided-edit",
            status: "queued"
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

    await startVideoRender({
      mode: "remix",
      prompt: "Make the architecture resemble this photo",
      sourceVideoId: "v1_source-interaction",
      sourceVideoUrl: "https://example.com/source.mp4",
      remixReferenceImageUrl: "https://example.com/reference.jpg",
      geminiApiKey: "test-gemini-key"
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://example.com/reference.jpg"
    );

    const request = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const payload = JSON.parse(String(request.body));

    expect(payload.previous_interaction_id).toBe("v1_source-interaction");
    expect(payload.input).toEqual([
      {
        type: "image",
        data: "BwgJ",
        mime_type: "image/jpeg"
      },
      {
        type: "text",
        text: expect.stringContaining(
          "Make the architecture resemble this photo"
        )
      }
    ]);
    expect(payload.input[1].text).toContain("<IMAGE_REF_0>");
  });

  it("uploads the current public MP4 when the source predates Gemini", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(new Uint8Array([4, 5, 6]), {
          status: 200,
          headers: {
            "Content-Type": "video/mp4"
          }
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "v1_legacy-edit-request",
            status: "queued"
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

    await startVideoRender({
      mode: "remix",
      prompt: "Turn the clouds into stained glass",
      sourceVideoId: "file_legacy-provider-id",
      sourceVideoUrl: "https://example.com/legacy-source.mp4",
      geminiApiKey: "test-gemini-key"
    });

    const request = fetchMock.mock.calls[1]?.[1] as RequestInit;

    expect(JSON.parse(String(request.body))).toMatchObject({
      input: [
        {
          type: "user_input",
          content: [
            {
              type: "video",
              data: "BAUG",
              mime_type: "video/mp4"
            },
            {
              type: "text",
              text: "Turn the clouds into stained glass"
            }
          ]
        }
      ],
      generation_config: {
        video_config: {
          task: "edit"
        }
      }
    });
  });

  it("recognizes explicit Gemini safety blocks without counting generic invalid input", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: 400,
              status: "INVALID_ARGUMENT",
              message: "This request was blocked by the video safety filter."
            }
          }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json"
            }
          }
        )
      )
    );

    const moderationError = await startVideoRender({
      mode: "seed",
      prompt: "Blocked prompt",
      geminiApiKey: "test-gemini-key"
    }).catch((error) => error);

    expect(isVideoModerationError(moderationError)).toBe(true);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: 400,
              status: "INVALID_ARGUMENT",
              message: "Prompt cannot be empty."
            }
          }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json"
            }
          }
        )
      )
    );

    const ordinaryInputError = await startVideoRender({
      mode: "seed",
      prompt: "",
      geminiApiKey: "test-gemini-key"
    }).catch((error) => error);

    expect(isVideoModerationError(ordinaryInputError)).toBe(false);
  });

  it("captures a complete inline video even while Omni still reports in progress", async () => {
    testDoubles.getEffectiveGeminiApiKeyForUser.mockResolvedValue("test-gemini-key");
    testDoubles.persistVideoAsset.mockResolvedValue({
      publicUrl: "https://cdn.example.com/render.mp4",
      storagePath: "renders/asset-1.mp4"
    });
    testDoubles.transaction.playbackState.updateMany.mockResolvedValue({
      count: 1
    });
    testDoubles.db.renderJob.findUnique
      .mockResolvedValueOnce({
        id: "render-1",
        sessionId: "session-1",
        submissionId: null,
        providerRequestId: "v1_render-request",
        outputAsset: {
          id: "asset-1"
        },
        session: {
          userId: "user-1",
          playbackState: {
            id: "playback-1",
            currentAssetId: null
          }
        }
      })
      .mockResolvedValueOnce({
        id: "render-1",
        sessionId: "session-1",
        submissionId: null,
        session: {
          playbackState: {
            id: "playback-1",
            currentAssetId: null
          }
        },
        submission: null
      });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: "v1_render-request",
            status: "in_progress",
            steps: [
              {
                type: "model_output",
                content: [
                  {
                    type: "video",
                    mime_type: "video/mp4",
                    data: "AQID"
                  }
                ]
              }
            ]
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json"
            }
          }
        )
      )
    );

    await expect(reconcileRenderJob("render-1")).resolves.toEqual({
      status: "completed",
      progress: 100
    });

    expect(testDoubles.persistVideoAsset).toHaveBeenCalledWith(
      "asset-1",
      Buffer.from([1, 2, 3])
    );
    expect(testDoubles.transaction.visualAsset.update).toHaveBeenCalledWith({
      where: {
        id: "asset-1"
      },
      data: {
        status: "ready",
        publicUrl: "https://cdn.example.com/render.mp4",
        storagePath: "renders/asset-1.mp4",
        sourceVideoId: "v1_render-request"
      }
    });
  });

  it("does not fail a render while its synchronous Gemini request is still starting", async () => {
    testDoubles.getEffectiveGeminiApiKeyForUser.mockResolvedValue(
      "test-gemini-key"
    );
    testDoubles.db.renderJob.findUnique.mockResolvedValue({
      id: "render-starting",
      sessionId: "session-1",
      submissionId: null,
      providerRequestId: null,
      providerOutputUri: null,
      status: "queued",
      createdAt: new Date(Date.now() - 10_000),
      outputAsset: {
        id: "asset-starting"
      },
      session: {
        userId: "user-1",
        playbackState: {
          id: "playback-1",
          currentAssetId: null
        }
      }
    });

    await expect(reconcileRenderJob("render-starting")).resolves.toEqual({
      status: "queued",
      progress: null
    });

    expect(testDoubles.transaction.renderJob.update).not.toHaveBeenCalled();
    expect(testDoubles.transaction.visualAsset.update).not.toHaveBeenCalled();
  });

  it.each([404, 429, 503])(
    "keeps a fresh background render alive through a transient Gemini %s lookup",
    async (status) => {
      testDoubles.getEffectiveGeminiApiKeyForUser.mockResolvedValue(
        "test-gemini-key"
      );
      testDoubles.db.renderJob.findUnique.mockResolvedValue({
        id: "render-transient",
        sessionId: "session-1",
        submissionId: null,
        providerRequestId: "v1_transient",
        providerOutputUri: null,
        providerStrategy: "stateful_edit",
        mode: "remix",
        status: "queued",
        createdAt: new Date(),
        outputAsset: {
          id: "asset-transient"
        },
        session: {
          userId: "user-1",
          playbackState: {
            id: "playback-1",
            currentAssetId: "asset-current"
          }
        }
      });
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              error: {
                code: status,
                status: "TEMPORARY",
                message: "Try again."
              }
            }),
            {
              status,
              headers: {
                "Content-Type": "application/json"
              }
            }
          )
        )
      );

      await expect(
        reconcileRenderJob("render-transient")
      ).resolves.toEqual({
        status: "in_progress",
        progress: null
      });

      expect(testDoubles.db.renderJob.updateMany).toHaveBeenCalledWith({
        where: {
          id: "render-transient",
          status: {
            in: ["queued", "in_progress"]
          }
        },
        data: {
          status: "in_progress",
          lastPolledAt: expect.any(Date)
        }
      });
      expect(testDoubles.db.$transaction).not.toHaveBeenCalled();
    }
  );

  it("keeps a fresh background render alive through a transient network failure", async () => {
    testDoubles.getEffectiveGeminiApiKeyForUser.mockResolvedValue(
      "test-gemini-key"
    );
    testDoubles.db.renderJob.findUnique.mockResolvedValue({
      id: "render-network",
      sessionId: "session-1",
      submissionId: null,
      providerRequestId: "v1_network",
      providerOutputUri: null,
      providerStrategy: "stateful_edit",
      mode: "remix",
      status: "in_progress",
      createdAt: new Date(),
      outputAsset: {
        id: "asset-network"
      },
      session: {
        userId: "user-1",
        playbackState: {
          id: "playback-1",
          currentAssetId: "asset-current"
        }
      }
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Temporary network failure"))
    );

    await expect(reconcileRenderJob("render-network")).resolves.toEqual({
      status: "in_progress",
      progress: null
    });
    expect(testDoubles.db.$transaction).not.toHaveBeenCalled();
  });

  it("does not reconcile a render that is already terminal", async () => {
    testDoubles.db.renderJob.findUnique.mockResolvedValue({
      id: "render-completed",
      status: "completed",
      outputAsset: {
        id: "asset-completed"
      },
      session: {
        userId: "user-1",
        playbackState: {
          id: "playback-1"
        }
      }
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(reconcileRenderJob("render-completed")).resolves.toEqual({
      status: "completed",
      progress: 100
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(testDoubles.db.$transaction).not.toHaveBeenCalled();
  });

  it("stores and completes a URI-delivered video through the Files API", async () => {
    testDoubles.getEffectiveGeminiApiKeyForUser.mockResolvedValue(
      "test-gemini-key"
    );
    testDoubles.persistVideoAsset.mockResolvedValue({
      publicUrl: "https://cdn.example.com/webhook-remix.mp4",
      storagePath: "renders/asset-1.mp4"
    });
    testDoubles.transaction.playbackState.updateMany.mockResolvedValue({
      count: 0
    });
    testDoubles.promoteOldestReadyAsset.mockResolvedValue("asset-1");
    testDoubles.db.renderJob.findUnique
      .mockResolvedValueOnce({
        id: "render-1",
        sessionId: "session-1",
        submissionId: "submission-1",
        providerRequestId: "v1_webhook-edit",
        status: "in_progress",
        outputAsset: {
          id: "asset-1"
        },
        session: {
          userId: "user-1",
          playbackState: {
            id: "playback-1",
            currentAssetId: "asset-current"
          }
        }
      })
      .mockResolvedValueOnce({
        id: "render-1",
        sessionId: "session-1",
        submissionId: "submission-1",
        session: {
          playbackState: {
            id: "playback-1",
            currentAssetId: "asset-current"
          }
        },
        submission: {
          id: "submission-1"
        }
      });

    const outputUri =
      "https://generativelanguage.googleapis.com/v1beta/files/rendered-file:download?alt=media";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            name: "files/rendered-file",
            state: "ACTIVE"
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json"
            }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([6, 5, 4]), {
          status: 200,
          headers: {
            "Content-Type": "video/mp4"
          }
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      completeGeminiVideoRender("v1_webhook-edit", outputUri)
    ).resolves.toBe("completed");

    expect(testDoubles.db.renderJob.updateMany).toHaveBeenCalledWith({
      where: {
        id: "render-1",
        status: {
          in: ["queued", "in_progress"]
        }
      },
      data: {
        providerOutputUri: outputUri,
        status: "in_progress",
        lastPolledAt: expect.any(Date)
      }
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://generativelanguage.googleapis.com/v1beta/files/rendered-file"
    );
    expect(testDoubles.persistVideoAsset).toHaveBeenCalledWith(
      "asset-1",
      Buffer.from([6, 5, 4])
    );
  });

  it("does not revive a terminal render while completing an output URI", async () => {
    testDoubles.getEffectiveGeminiApiKeyForUser.mockResolvedValue(
      "test-gemini-key"
    );
    testDoubles.db.renderJob.findUnique.mockResolvedValueOnce({
      id: "render-terminal",
      status: "in_progress",
      outputAsset: {
        id: "asset-terminal"
      },
      session: {
        userId: "user-1",
        playbackState: {
          id: "playback-1",
          currentAssetId: "asset-current"
        }
      }
    });
    testDoubles.db.renderJob.updateMany.mockResolvedValueOnce({
      count: 0
    });

    await expect(
      completeGeminiVideoRender(
        "v1_terminal",
        "https://generativelanguage.googleapis.com/v1beta/files/terminal:download?alt=media"
      )
    ).resolves.toBe("in_progress");

    expect(testDoubles.persistVideoAsset).not.toHaveBeenCalled();
    expect(testDoubles.transaction.visualAsset.update).not.toHaveBeenCalled();
  });

  it("waits on a URI-delivered video without polling the interaction", async () => {
    testDoubles.getEffectiveGeminiApiKeyForUser.mockResolvedValue(
      "test-gemini-key"
    );
    const outputUri =
      "https://generativelanguage.googleapis.com/v1beta/files/rendered-file:download?alt=media";
    testDoubles.db.renderJob.findUnique
      .mockResolvedValueOnce({
        id: "render-1",
        sessionId: "session-1",
        submissionId: "submission-1",
        providerRequestId: "v1_sync-edit",
        providerOutputUri: outputUri,
        status: "in_progress",
        outputAsset: {
          id: "asset-1"
        },
        session: {
          userId: "user-1",
          playbackState: {
            id: "playback-1",
            currentAssetId: "asset-current"
          }
        }
      })
      .mockResolvedValueOnce({
        id: "render-1",
        sessionId: "session-1",
        submissionId: "submission-1",
        providerRequestId: "v1_sync-edit",
        status: "in_progress",
        outputAsset: {
          id: "asset-1"
        },
        session: {
          userId: "user-1",
          playbackState: {
            id: "playback-1",
            currentAssetId: "asset-current"
          }
        }
      });

    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          name: "files/rendered-file",
          state: "PROCESSING"
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

    await expect(reconcileRenderJob("render-1")).resolves.toEqual({
      status: "in_progress",
      progress: null
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://generativelanguage.googleapis.com/v1beta/files/rendered-file"
    );
  });

  it("recovers a completed background edit from the event stream when standard lookup fails", async () => {
    testDoubles.getEffectiveGeminiApiKeyForUser.mockResolvedValue(
      "test-gemini-key"
    );
    testDoubles.persistVideoAsset.mockResolvedValue({
      publicUrl: "https://cdn.example.com/recovered-remix.mp4",
      storagePath: "renders/asset-1.mp4"
    });
    testDoubles.transaction.playbackState.updateMany.mockResolvedValue({
      count: 0
    });
    testDoubles.promoteOldestReadyAsset.mockResolvedValue("asset-1");
    testDoubles.db.renderJob.findUnique
      .mockResolvedValueOnce({
        id: "render-1",
        sessionId: "session-1",
        submissionId: "submission-1",
        providerRequestId: "v1_background-edit",
        outputAsset: {
          id: "asset-1"
        },
        session: {
          userId: "user-1",
          playbackState: {
            id: "playback-1",
            currentAssetId: "asset-current"
          }
        }
      })
      .mockResolvedValueOnce({
        id: "render-1",
        sessionId: "session-1",
        submissionId: "submission-1",
        session: {
          playbackState: {
            id: "playback-1",
            currentAssetId: "asset-current"
          }
        },
        submission: {
          id: "submission-1"
        }
      });

    const streamPayload = [
      "event: step.done",
      "data: {\"event_type\":\"step.done\",\"step\":{\"type\":\"model_output\",\"content\":[{\"type\":\"video\",\"mime_type\":\"video/mp4\",\"uri\":\"https://generativelanguage.googleapis.com/v1beta/files/recovered:download?alt=media\"}]}}",
      "",
      "event: interaction.completed",
      "data: {\"event_type\":\"interaction.completed\",\"interaction\":{\"id\":\"v1_background-edit\",\"status\":\"completed\"}}",
      "",
      ""
    ].join("\n");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: 400,
              status: "INVALID_ARGUMENT",
              message: "Request contains an invalid argument."
            }
          }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json"
            }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(streamPayload, {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream"
          }
        })
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([9, 8, 7]), {
          status: 200,
          headers: {
            "Content-Type": "video/mp4"
          }
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(reconcileRenderJob("render-1")).resolves.toEqual({
      status: "completed",
      progress: 100
    });

    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://generativelanguage.googleapis.com/v1beta/interactions/v1_background-edit?stream=true"
    );
    expect(testDoubles.persistVideoAsset).toHaveBeenCalledWith(
      "asset-1",
      Buffer.from([9, 8, 7])
    );
  });

  it("retires a stale invalid interaction so the queue can retry it", async () => {
    testDoubles.getEffectiveGeminiApiKeyForUser.mockResolvedValue(
      "test-gemini-key"
    );
    testDoubles.db.renderJob.count.mockResolvedValue(0);
    testDoubles.db.renderJob.findUnique
      .mockResolvedValueOnce({
        id: "render-stale",
        sessionId: "session-1",
        submissionId: "submission-1",
        providerRequestId: "v1_stale-edit",
        providerOutputUri: null,
        providerStrategy: "stateful_edit",
        status: "in_progress",
        createdAt: new Date(Date.now() - 3 * 60 * 1_000),
        outputAsset: {
          id: "asset-stale"
        },
        session: {
          userId: "user-1",
          playbackState: {
            id: "playback-1",
            currentAssetId: "asset-current"
          }
        }
      })
      .mockResolvedValueOnce({
        id: "render-stale",
        outputAssetId: "asset-stale",
        submissionId: "submission-1",
        sessionId: "session-1",
        status: "in_progress",
        submission: {
          source: "web",
          senderFingerprint: "device-hash"
        }
      });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: 400,
              status: "INVALID_ARGUMENT",
              message: "Request contains an invalid argument."
            }
          }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json"
            }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response("", {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream"
          }
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(reconcileRenderJob("render-stale")).resolves.toEqual({
      status: "failed",
      progress: null
    });

    expect(testDoubles.transaction.promptSubmission.update).toHaveBeenCalledWith({
      where: {
        id: "submission-1"
      },
      data: {
        status: "approved",
        selectedAt: null
      }
    });
    expect(testDoubles.recordAuditEvent).toHaveBeenCalledWith({
      type: "render.recovery_timeout",
      summary: "Retired a stalled Gemini Omni render so the queue could retry",
      details: "v1_stale-edit",
      sessionId: "session-1"
    });
  });

  it("stops retrying a submission after its recovery attempt also fails", async () => {
    testDoubles.db.renderJob.findUnique.mockResolvedValue({
      id: "render-retry",
      outputAssetId: "asset-retry",
      submissionId: "submission-1",
      sessionId: "session-1",
      status: "in_progress",
      submission: {
        source: "web",
        senderFingerprint: "device-hash"
      }
    });
    testDoubles.db.renderJob.count.mockResolvedValue(1);

    await failRenderJob("render-retry", "Second provider failure.");

    expect(testDoubles.transaction.promptSubmission.update).toHaveBeenCalledWith({
      where: {
        id: "submission-1"
      },
      data: {
        status: "failed",
        selectedAt: null
      }
    });
  });

  it("does not mistake the echoed source video for a completed remix", async () => {
    testDoubles.getEffectiveGeminiApiKeyForUser.mockResolvedValue(
      "test-gemini-key"
    );
    testDoubles.db.renderJob.findUnique.mockResolvedValue({
      id: "render-1",
      sessionId: "session-1",
      submissionId: null,
      providerRequestId: "v1_render-request",
      outputAsset: {
        id: "asset-1"
      },
      session: {
        userId: "user-1",
        playbackState: {
          id: "playback-1",
          currentAssetId: "asset-current"
        }
      }
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: "v1_render-request",
            status: "in_progress",
            steps: [
              {
                type: "user_input",
                content: [
                  {
                    type: "video",
                    mime_type: "video/mp4",
                    data: "AQID"
                  }
                ]
              }
            ]
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json"
            }
          }
        )
      )
    );

    await expect(reconcileRenderJob("render-1")).resolves.toEqual({
      status: "in_progress",
      progress: null
    });
    expect(testDoubles.persistVideoAsset).not.toHaveBeenCalled();
  });

  it("rejects the blocked web submission and records one session-scoped strike", async () => {
    testDoubles.db.renderJob.findUnique.mockResolvedValue({
      id: "render-1",
      outputAssetId: "asset-1",
      submissionId: "submission-1",
      sessionId: "session-1",
      status: "in_progress",
      submission: {
        source: "web",
        senderFingerprint: "device-hash"
      }
    });
    testDoubles.db.auditEvent.count.mockResolvedValue(3);

    await expect(
      failRenderJob("render-1", videoModerationBlockedReason, {
        moderationBlocked: true
      })
    ).resolves.toEqual({
      failed: true,
      changed: true,
      moderationBlockCount: 3,
      banned: true
    });

    expect(testDoubles.transaction.promptSubmission.update).toHaveBeenCalledWith({
      where: {
        id: "submission-1"
      },
      data: {
        status: "rejected",
        selectedAt: null,
        approvalReason: videoModerationBlockedReason
      }
    });
    expect(testDoubles.recordAuditEvent).toHaveBeenCalledWith({
      type: "participant.media_moderation_block.device-hash",
      summary: "Counted a participant video-moderation block",
      details: "render-1",
      sessionId: "session-1"
    });
  });

  it("does not count the same failed render twice", async () => {
    testDoubles.db.renderJob.findUnique.mockResolvedValue({
      id: "render-1",
      outputAssetId: "asset-1",
      submissionId: "submission-1",
      sessionId: "session-1",
      status: "failed",
      submission: {
        source: "web",
        senderFingerprint: "device-hash"
      }
    });

    await failRenderJob("render-1", videoModerationBlockedReason, {
      moderationBlocked: true
    });

    expect(testDoubles.recordAuditEvent).not.toHaveBeenCalled();
    expect(testDoubles.db.$transaction).not.toHaveBeenCalled();
  });

  it("never changes a completed render back to failed", async () => {
    testDoubles.db.renderJob.findUnique.mockResolvedValue({
      id: "render-completed",
      outputAssetId: "asset-completed",
      submissionId: "submission-1",
      sessionId: "session-1",
      status: "completed",
      submission: {
        source: "web",
        senderFingerprint: "device-hash"
      }
    });

    await expect(
      failRenderJob("render-completed", "Late polling failure.")
    ).resolves.toEqual({
      failed: false,
      changed: false,
      moderationBlockCount: 0,
      banned: false
    });

    expect(testDoubles.db.$transaction).not.toHaveBeenCalled();
    expect(testDoubles.recordAuditEvent).not.toHaveBeenCalled();
  });
});
