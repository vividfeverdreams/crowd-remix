import { recordAuditEvent } from "@/lib/audit";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getEffectiveGeminiApiKeyForUser } from "@/lib/google-key-store";
import {
  getParticipantModerationBlockCount,
  getParticipantModerationEventType,
  isParticipantBanned
} from "@/lib/participant-session";
import { promoteOldestReadyAsset } from "@/lib/playback-queue";
import { estimateVideoRenderProgress } from "@/lib/render-progress";
import { recordRenderJobProgress } from "@/lib/render-progress-state";
import {
  downloadRunwayVideo,
  isRetryableRunwayError,
  isRunwayModerationError,
  retrieveRunwayTask,
  RunwayApiError,
  startRunwayVideoRender,
  type RunwayTask
} from "@/lib/runway-video";
import { getDemoLoopUrl, persistVideoAsset } from "@/lib/storage";
import { formatVideoDuration } from "@/lib/video-duration";
import {
  defaultVideoModelId,
  getVideoModelDefinition,
  isVideoModelId,
  type VideoModelId
} from "@/lib/video-models";
import {
  composeVideoPrompt,
  providerCrowdReferenceRequirement,
  providerOpeningFrameContinuityRequirement
} from "@/lib/video-prompt-budget";

const geminiInteractionsUrl = "https://generativelanguage.googleapis.com/v1beta/interactions";
const geminiApiRevision = "2026-05-20";
const staleGeminiRenderMs = 2 * 60 * 1_000;
const staleRunwayRenderMs = 30 * 60 * 1_000;

type StartRenderInput = {
  mode: "seed" | "remix";
  prompt: string;
  sourceVideoId?: string | null;
  sourceVideoUrl?: string | null;
  imageReferenceUrl?: string | null;
  openingFrameImageUrl?: string | null;
  remixReferenceImageUrl?: string | null;
  runwayApiKey?: string | null;
  geminiApiKey?: string | null;
  durationSeconds?: number | null;
  videoModel?: VideoModelId | string | null;
};

type StartedRender =
  | {
      kind: "demo";
      videoId: string;
      publicUrl: string;
      storagePath: null;
    }
  | {
      kind: "live";
      requestId: string;
      outputUri: string | null;
      strategy:
        | "seed"
        | "stateful_edit"
        | "uploaded_edit"
        | "runway_text_to_video"
        | "runway_image_to_video"
        | "runway_video_to_video";
    };

type GeminiVideoContent = {
  type?: "video";
  data?: string;
  mime_type?: string;
  uri?: string;
};

type GeminiInteraction = {
  id?: string;
  status?:
    | "queued"
    | "in_progress"
    | "requires_action"
    | "completed"
    | "failed"
    | "cancelled"
    | "incomplete"
    | "budget_exceeded";
  output_video?: GeminiVideoContent;
  steps?: Array<{
    type?: string;
    content?: Array<
      | GeminiVideoContent
      | {
          type?: string;
          text?: string;
        }
    >;
  }>;
  error?: {
    code?: string | number;
    message?: string;
    status?: string;
  } | null;
  incomplete_details?: unknown;
};

type GeminiInteractionStreamEvent = {
  event_type?: string;
  interaction?: GeminiInteraction;
  step?: {
    type?: string;
    content?: Array<GeminiVideoContent | { type?: string; text?: string }>;
  };
  delta?: GeminiVideoContent | { type?: string; text?: string };
  error?: {
    code?: string | number;
    message?: string;
    status?: string;
  } | null;
};

export const videoModerationBlockedReason =
  "The video provider blocked this render during moderation.";
const legacyGeminiModerationBlockedReason =
  "Gemini Omni blocked this render during video moderation.";
const legacyGrokModerationBlockedReason =
  "Grok Imagine blocked this render during video moderation.";

class GeminiVideoApiError extends Error {
  code: string | null;
  moderationBlocked: boolean;
  status: number;

  constructor(
    message: string,
    input: {
      code?: string | null;
      moderationBlocked?: boolean;
      status: number;
    }
  ) {
    super(message);
    this.name = "GeminiVideoApiError";
    this.code = input.code ?? null;
    this.moderationBlocked = input.moderationBlocked ?? false;
    this.status = input.status;
  }
}

export function isVideoModerationError(error: unknown) {
  return (
    isRunwayModerationError(error) ||
    (error instanceof GeminiVideoApiError && error.moderationBlocked) ||
    (error instanceof Error && isVideoModerationFailure(null, error.message))
  );
}

export function isVideoModerationFailureReason(
  failureReason: string | null | undefined
) {
  return Boolean(
    failureReason &&
      [
        videoModerationBlockedReason,
        legacyGeminiModerationBlockedReason,
        legacyGrokModerationBlockedReason
      ].some(
        (reason) => failureReason === reason || failureReason.startsWith(`${reason} `)
      )
  );
}

function getGeminiRecoveryTimeoutMs(renderJob: {
  mode?: string | null;
  providerStrategy?: string | null;
}) {
  return renderJob.mode === "remix" &&
    renderJob.providerStrategy !== "stateful_edit"
    ? 2 * 60 * 1_000
    : staleGeminiRenderMs;
}

const remoteMediaDownloadTimeoutMs = 8_000;

function ensureOpeningFramePrompt(
  prompt: string,
  openingFrameAttached: boolean,
  crowdReferenceAttached: boolean
) {
  if (
    !openingFrameAttached ||
    prompt.trimStart().startsWith(providerOpeningFrameContinuityRequirement)
  ) {
    return prompt;
  }

  return composeVideoPrompt({
    leadingRequirements: [
      providerOpeningFrameContinuityRequirement,
      crowdReferenceAttached ? providerCrowdReferenceRequirement : null
    ],
    context: [prompt],
    requirements: []
  });
}

function buildGeminiRemixPrompt(
  prompt: string,
  openingFrameAttached: boolean,
  crowdReferenceAttached: boolean
) {
  if (openingFrameAttached || !crowdReferenceAttached) {
    return prompt;
  }

  return [
    "REFERENCE IMAGE: Image 1 is the crowd photo (<IMAGE_REF_0>), not an opening-frame anchor.",
    "Treat references to the attached photo, image, or picture as references to <IMAGE_REF_0>.",
    prompt
  ].join(" ");
}

function isRetryableGeminiReconciliationError(error: unknown) {
  if (isVideoModerationError(error)) {
    return false;
  }

  if (error instanceof GeminiVideoApiError) {
    return error.status !== 401 && error.status !== 403;
  }

  // Fetch/network/stream failures do not prove that a background interaction
  // failed. Keep polling until the bounded recovery window expires.
  return error instanceof Error;
}

export async function startVideoRender(input: StartRenderInput): Promise<StartedRender> {
  const requestedVideoModel = input.videoModel ?? defaultVideoModelId;

  if (!isVideoModelId(requestedVideoModel)) {
    throw new Error(`Unsupported video model: ${requestedVideoModel}`);
  }

  const providerPrompt = ensureOpeningFramePrompt(
    input.prompt,
    Boolean(input.mode === "remix" && input.openingFrameImageUrl),
    Boolean(input.mode === "remix" && input.remixReferenceImageUrl)
  );

  if (input.runwayApiKey) {
    const started = await startRunwayVideoRender({
      mode: input.mode,
      prompt: providerPrompt,
      sourceVideoUrl: input.sourceVideoUrl,
      imageReferenceUrl: input.imageReferenceUrl,
      openingFrameImageUrl: input.openingFrameImageUrl,
      remixReferenceImageUrl: input.remixReferenceImageUrl,
      apiKey: input.runwayApiKey,
      durationSeconds: input.durationSeconds,
      model: requestedVideoModel
    });

    console.info("[render-job] Runway task started", {
      taskId: started.requestId,
      mode: input.mode,
      strategy: started.strategy
    });

    return {
      kind: "live",
      requestId: started.requestId,
      outputUri: null,
      strategy: started.strategy
    };
  }

  if (!input.geminiApiKey) {
    return {
      kind: "demo",
      videoId: `demo_${Date.now()}`,
      publicUrl: getDemoLoopUrl(),
      storagePath: null
    };
  }

  if (requestedVideoModel !== defaultVideoModelId) {
    const model = getVideoModelDefinition(requestedVideoModel);

    throw new Error(
      `${model.label} requires a Runway API key. Configure RUNWAYML_API_SECRET or select Gemini Omni Flash.`
    );
  }

  const statefulSourceId =
    input.mode === "remix" && input.sourceVideoId?.startsWith("v1_")
      ? input.sourceVideoId
      : null;

  if (input.mode === "remix" && !statefulSourceId && !input.sourceVideoUrl) {
    throw new Error("Gemini Omni video editing requires a completed source video.");
  }

  const requestBody: Record<string, unknown> = {
    model: env.geminiVideoModel,
    // Video creation is a long-running interaction. Asking Gemini to run it in
    // the background makes this request return the interaction ID promptly so
    // our reconciler never mistakes a still-starting request for a failed one.
    background: true,
    store: true,
    stream: false,
    response_format: {
      type: "video",
      delivery: "uri",
      ...(input.mode === "seed"
        ? {
            aspect_ratio: "16:9",
            duration: formatVideoDuration(input.durationSeconds)
          }
        : {})
    }
  };

  // Omni-generated videos should be edited statefully. Google retains the full
  // prior video context under the interaction ID, avoiding uploaded-video limits.
  if (input.mode === "remix" && statefulSourceId) {
    const [openingFrameImage, crowdReferenceImage] = await Promise.all([
      input.openingFrameImageUrl
        ? fetchRemoteMedia(
            input.openingFrameImageUrl,
            "image/jpeg",
            "opening-frame image"
          )
        : Promise.resolve(null),
      input.remixReferenceImageUrl
        ? fetchRemoteMedia(
            input.remixReferenceImageUrl,
            "image/jpeg",
            "crowd reference image"
          )
        : Promise.resolve(null)
    ]);
    const referenceImages = [openingFrameImage, crowdReferenceImage].filter(
      (image): image is NonNullable<typeof image> => image !== null
    );
    const remixPrompt = buildGeminiRemixPrompt(
      providerPrompt,
      Boolean(openingFrameImage),
      Boolean(crowdReferenceImage)
    );

    requestBody.previous_interaction_id = statefulSourceId;
    requestBody.input = referenceImages.length > 0
      ? [
          ...referenceImages.map((image) => ({
            type: "image",
            data: image.data,
            mime_type: image.mimeType
          })),
          {
            type: "text",
            text: remixPrompt
          }
        ]
      : remixPrompt;
  } else if (input.mode === "remix" && input.sourceVideoUrl) {
    const [sourceVideo, openingFrameImage, crowdReferenceImage] = await Promise.all([
      fetchRemoteMedia(
        input.sourceVideoUrl,
        "video/mp4",
        "source video"
      ),
      input.openingFrameImageUrl
        ? fetchRemoteMedia(
            input.openingFrameImageUrl,
            "image/jpeg",
            "opening-frame image"
          )
        : Promise.resolve(null),
      input.remixReferenceImageUrl
        ? fetchRemoteMedia(
            input.remixReferenceImageUrl,
            "image/jpeg",
            "crowd reference image"
          )
        : Promise.resolve(null)
    ]);
    const referenceImages = [openingFrameImage, crowdReferenceImage].filter(
      (image): image is NonNullable<typeof image> => image !== null
    );
    const remixPrompt = buildGeminiRemixPrompt(
      providerPrompt,
      Boolean(openingFrameImage),
      Boolean(crowdReferenceImage)
    );

    requestBody.input = [
      {
        type: "user_input",
        content: [
          {
            type: "video",
            data: sourceVideo.data,
            mime_type: sourceVideo.mimeType
          },
          ...referenceImages.map((image) => ({
            type: "image",
            data: image.data,
            mime_type: image.mimeType
          })),
          {
            type: "text",
            text: remixPrompt
          }
        ]
      }
    ];
    requestBody.generation_config = {
      video_config: {
        task: "edit"
      }
    };
  } else if (input.imageReferenceUrl) {
    const referenceImage = await fetchRemoteMedia(
      input.imageReferenceUrl,
      "image/jpeg",
      "reference image"
    );

    requestBody.input = [
      {
        type: "image",
        data: referenceImage.data,
        mime_type: referenceImage.mimeType
      },
      {
        type: "text",
        text: providerPrompt
      }
    ];
    requestBody.generation_config = {
      video_config: {
        task: "image_to_video"
      }
    };
  } else {
    requestBody.input = providerPrompt;
    requestBody.generation_config = {
      video_config: {
        task: "text_to_video"
      }
    };
  }

  const interaction = await callGeminiVideoApi<GeminiInteraction>(
    geminiInteractionsUrl,
    input.geminiApiKey,
    {
      method: "POST",
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(45_000)
    }
  );

  if (!interaction.id) {
    throw new Error("Gemini Omni started without returning an interaction ID.");
  }

  const strategy =
    input.mode === "seed"
      ? "seed"
      : statefulSourceId
        ? "stateful_edit"
        : "uploaded_edit";
  const outputUri = extractVideoOutput(interaction)?.uri ?? null;

  console.info("[render-job] Gemini Omni request completed", {
    interactionId: interaction.id,
    mode: input.mode,
    strategy,
    durationSeconds:
      input.mode === "seed"
        ? formatVideoDuration(input.durationSeconds)
        : "preserved_from_source",
    outputUriAvailable: Boolean(outputUri)
  });

  return {
    kind: "live",
    requestId: interaction.id,
    outputUri,
    strategy
  };
}

type ProgressRenderJob = {
  id: string;
  sessionId: string;
  createdAt: Date;
};

async function reportEstimatedRenderProgress(
  renderJob: ProgressRenderJob,
  status: "queued" | "in_progress"
) {
  const estimate = estimateVideoRenderProgress({
    status,
    createdAt: renderJob.createdAt
  });
  const progress = await recordRenderJobProgress(
    renderJob.sessionId,
    renderJob.id,
    estimate
  );

  return {
    status,
    progress
  };
}

async function reportCompletedRenderProgress(renderJob: ProgressRenderJob) {
  const progress = await recordRenderJobProgress(
    renderJob.sessionId,
    renderJob.id,
    100
  );

  return {
    status: "completed" as const,
    progress
  };
}

export async function reconcileRenderJob(renderJobId: string) {
  const renderJob = await db.renderJob.findUnique({
    where: {
      id: renderJobId
    },
    include: {
      outputAsset: true,
      session: {
        include: {
          playbackState: true
        }
      }
    }
  });

  if (!renderJob || !renderJob.outputAsset) {
    return null;
  }

  if (renderJob.status === "completed") {
    return reportCompletedRenderProgress(renderJob);
  }

  if (renderJob.status === "failed") {
    return {
      status: "failed" as const,
      progress: null
    };
  }

  if (!renderJob.providerRequestId) {
    const renderAgeMs =
      renderJob.createdAt instanceof Date
        ? Date.now() - renderJob.createdAt.getTime()
        : 0;

    // The job can be visible to the dashboard during the short gap between
    // creating the background interaction and storing its ID. Give that claim
    // time to finish instead of racing reconciliation against it.
    if (renderAgeMs < staleGeminiRenderMs) {
      return reportEstimatedRenderProgress(renderJob, "queued");
    }

    const failureResult = await failRenderJob(
      renderJob.id,
      "Render job never received a provider task ID."
    );
    const failed = Boolean(failureResult && failureResult.failed);

    return failed
      ? {
          status: "failed" as const,
          progress: 0
        }
      : reportEstimatedRenderProgress(renderJob, "in_progress");
  }

  if (renderJob.providerStrategy?.startsWith("runway_")) {
    return reconcileRunwayRenderJob(
      renderJob,
      renderJob.providerRequestId,
      renderJob.outputAsset.id
    );
  }

  const apiKey = renderJob.session?.userId
    ? await getEffectiveGeminiApiKeyForUser(String(renderJob.session.userId))
    : null;

  if (!apiKey) {
    const completed = await markRenderJobReady(
      renderJob.id,
      renderJob.outputAsset.id,
      {
        publicUrl: getDemoLoopUrl(),
        storagePath: null,
        sourceVideoId: renderJob.providerRequestId ?? `demo_${renderJob.id}`
      }
    );

    if (!completed) {
      return reportEstimatedRenderProgress(renderJob, "in_progress");
    }

    return reportCompletedRenderProgress(renderJob);
  }

  if (renderJob.providerOutputUri) {
    try {
      const completion = await completeGeminiVideoRender(
        renderJob.providerRequestId,
        renderJob.providerOutputUri
      );

      if (completion === "completed") {
        return reportCompletedRenderProgress(renderJob);
      }

      if (completion === "in_progress") {
        return reportEstimatedRenderProgress(renderJob, "in_progress");
      }
    } catch (error) {
      console.warn("[render-job] URI-delivered Gemini video is not ready", {
        sessionId: renderJob.sessionId,
        renderJobId: renderJob.id,
        reason:
          error instanceof Error
            ? error.message
            : "Gemini video retrieval failed."
      });
    }
  }

  let interaction: GeminiInteraction | null;

  try {
    interaction = await retrieveGeminiVideoInteraction(
      renderJob.providerRequestId,
      apiKey
    );
  } catch (error) {
    const failureReason =
      error instanceof Error
        ? error.message
        : "Gemini Omni could not return this render.";
    const moderationBlocked = isVideoModerationError(error);
    const retryable = isRetryableGeminiReconciliationError(error);
    const renderAgeMs =
      renderJob.createdAt instanceof Date
        ? Date.now() - renderJob.createdAt.getTime()
        : 0;

    if (
      !moderationBlocked &&
      retryable &&
      renderAgeMs < getGeminiRecoveryTimeoutMs(renderJob)
    ) {
      console.warn("[render-job] transient Gemini reconciliation failure", {
        sessionId: renderJob.sessionId,
        renderJobId: renderJob.id,
        providerStatus:
          error instanceof GeminiVideoApiError ? error.status : null,
        providerCode:
          error instanceof GeminiVideoApiError ? error.code : null,
        failureReason
      });
      await db.renderJob.updateMany({
        where: {
          id: renderJob.id,
          status: {
            in: ["queued", "in_progress"]
          }
        },
        data: {
          status: "in_progress",
          lastPolledAt: new Date()
        }
      });

      return reportEstimatedRenderProgress(renderJob, "in_progress");
    }

    console.error("[render-job] Gemini reconciliation failed", {
      sessionId: renderJob.sessionId,
      renderJobId: renderJob.id,
      providerStatus:
        error instanceof GeminiVideoApiError ? error.status : null,
      providerCode:
        error instanceof GeminiVideoApiError ? error.code : null,
      failureReason
    });

    const failureResult = await failRenderJob(
      renderJob.id,
      moderationBlocked
        ? formatVideoModerationFailureReason(failureReason)
        : failureReason,
      {
        moderationBlocked
      }
    );
    const failed = Boolean(failureResult && failureResult.failed);

    return failed
      ? {
          status: "failed" as const,
          progress: null
        }
      : reportEstimatedRenderProgress(renderJob, "in_progress");
  }

  if (!interaction) {
    const staleAfterMs = getGeminiRecoveryTimeoutMs(renderJob);

    if (
      renderJob.createdAt instanceof Date &&
      Date.now() - renderJob.createdAt.getTime() >= staleAfterMs
    ) {
      const failureReason =
        "Gemini Omni did not publish a usable result before the recovery timeout.";

      console.warn("[render-job] retiring stale Gemini interaction", {
        sessionId: renderJob.sessionId,
        renderJobId: renderJob.id,
        providerRequestId: renderJob.providerRequestId,
        ageMs: Date.now() - renderJob.createdAt.getTime()
      });

      const failureResult = await failRenderJob(renderJob.id, failureReason, {
        forceRetry: renderJob.providerStrategy !== "stateful_edit"
      });
      const failed = Boolean(failureResult && failureResult.failed);

      if (failureResult && failureResult.changed) {
        await recordAuditEvent({
          type: "render.recovery_timeout",
          summary: "Retired a stalled Gemini Omni render so the queue could retry",
          details: renderJob.providerRequestId,
          sessionId: renderJob.sessionId
        });
      }

      return failed
        ? {
            status: "failed" as const,
            progress: null
          }
        : reportEstimatedRenderProgress(renderJob, "in_progress");
    }

    await db.renderJob.updateMany({
      where: {
        id: renderJob.id,
        status: {
          in: ["queued", "in_progress"]
        }
      },
      data: {
        status: "in_progress",
        lastPolledAt: new Date()
      }
    });

    return reportEstimatedRenderProgress(renderJob, "in_progress");
  }

  const video = extractVideoOutput(interaction);

  if (video) {
    const buffer = await resolveVideoBuffer(video, apiKey);
    const saved = await persistVideoAsset(renderJob.outputAsset.id, buffer);

    const completed = await markRenderJobReady(renderJob.id, renderJob.outputAsset.id, {
      publicUrl: saved.publicUrl,
      storagePath: saved.storagePath,
      thumbnailUrl: saved.thumbnailUrl,
      sourceVideoId: interaction.id ?? renderJob.providerRequestId
    });

    if (!completed) {
      return reportEstimatedRenderProgress(renderJob, "in_progress");
    }

    return reportCompletedRenderProgress(renderJob);
  }

  if (interaction.status === "completed") {
    const providerError = getInteractionFailureMessage(interaction);
    const moderationBlocked = isVideoModerationFailure(null, providerError);

    const failureResult = await failRenderJob(
      renderJob.id,
      moderationBlocked
        ? formatVideoModerationFailureReason(providerError)
        : providerError || "Gemini Omni completed without returning a video.",
      {
        moderationBlocked
      }
    );
    const failed = Boolean(failureResult && failureResult.failed);

    return failed
      ? {
          status: "failed" as const,
          progress: null
        }
      : reportEstimatedRenderProgress(renderJob, "in_progress");
  }

  if (
    interaction.status === "failed" ||
    interaction.status === "cancelled" ||
    interaction.status === "incomplete" ||
    interaction.status === "budget_exceeded" ||
    interaction.status === "requires_action"
  ) {
    const providerError = getInteractionFailureMessage(interaction);
    const moderationBlocked = isVideoModerationFailure(
      interaction.error?.code,
      providerError
    );

    const failureResult = await failRenderJob(
      renderJob.id,
      moderationBlocked
        ? formatVideoModerationFailureReason(providerError)
        : providerError ||
            `Gemini Omni reported a ${interaction.status.replaceAll("_", " ")} render.`,
      {
        moderationBlocked
      }
    );
    const failed = Boolean(failureResult && failureResult.failed);

    return failed
      ? {
          status: "failed" as const,
          progress: null
        }
      : reportEstimatedRenderProgress(renderJob, "in_progress");
  }

  const mappedStatus = interaction.status === "queued" ? "queued" : "in_progress";

  await db.renderJob.updateMany({
    where: {
      id: renderJob.id,
      status: {
        in: ["queued", "in_progress"]
      }
    },
    data: {
      status: mappedStatus,
      lastPolledAt: new Date()
    }
  });

  return reportEstimatedRenderProgress(renderJob, mappedStatus);
}

type RunwayBackedRenderJob = ProgressRenderJob & {
  providerRequestId: string | null;
  providerStrategy: string | null;
  outputAsset: {
    id: string;
  } | null;
};

async function reconcileRunwayRenderJob(
  renderJob: RunwayBackedRenderJob,
  providerRequestId: string,
  outputAssetId: string
) {
  const renderAgeMs = Date.now() - renderJob.createdAt.getTime();

  if (!env.runwayApiSecret) {
    const failureResult = await failRenderJob(
      renderJob.id,
      "Runway video generation is not configured on the server."
    );

    return failureResult && failureResult.failed
      ? {
          status: "failed" as const,
          progress: null
        }
      : reportEstimatedRenderProgress(renderJob, "in_progress");
  }

  let task: RunwayTask;

  try {
    task = await retrieveRunwayTask(
      providerRequestId,
      env.runwayApiSecret
    );
  } catch (error) {
    const failureReason =
      error instanceof Error
        ? error.message
        : "Runway could not return this render task.";

    if (
      isRetryableRunwayError(error) &&
      renderAgeMs < staleRunwayRenderMs
    ) {
      console.warn("[render-job] transient Runway reconciliation failure", {
        sessionId: renderJob.sessionId,
        renderJobId: renderJob.id,
        providerStatus:
          error instanceof RunwayApiError ? error.status : null,
        failureReason
      });
      await updateRunwayRenderStatus(renderJob, "in_progress");
      return reportEstimatedRenderProgress(renderJob, "in_progress");
    }

    console.error("[render-job] Runway reconciliation failed", {
      sessionId: renderJob.sessionId,
      renderJobId: renderJob.id,
      providerStatus: error instanceof RunwayApiError ? error.status : null,
      failureReason
    });

    const moderationBlocked = isRunwayModerationError(error);
    const failureResult = await failRenderJob(
      renderJob.id,
      moderationBlocked
        ? formatVideoModerationFailureReason(failureReason)
        : failureReason,
      {
        moderationBlocked
      }
    );

    return failureResult && failureResult.failed
      ? {
          status: "failed" as const,
          progress: null
        }
      : reportEstimatedRenderProgress(renderJob, "in_progress");
  }

  if (task.status === "PENDING" || task.status === "THROTTLED") {
    if (renderAgeMs >= staleRunwayRenderMs) {
      const failureResult = await failRenderJob(
        renderJob.id,
        "Runway did not begin this render before the recovery timeout."
      );

      return failureResult && failureResult.failed
        ? {
            status: "failed" as const,
            progress: null
          }
        : reportEstimatedRenderProgress(renderJob, "in_progress");
    }

    await updateRunwayRenderStatus(renderJob, "queued");
    return reportEstimatedRenderProgress(renderJob, "queued");
  }

  if (task.status === "RUNNING") {
    if (renderAgeMs >= staleRunwayRenderMs) {
      const failureResult = await failRenderJob(
        renderJob.id,
        "Runway did not finish this render before the recovery timeout."
      );

      return failureResult && failureResult.failed
        ? {
            status: "failed" as const,
            progress: null
          }
        : reportEstimatedRenderProgress(renderJob, "in_progress");
    }

    await updateRunwayRenderStatus(renderJob, "in_progress");
    return reportRunwayRenderProgress(renderJob, task.progress ?? 0);
  }

  if (task.status === "SUCCEEDED") {
    const outputUri = task.output?.find(
      (value): value is string => typeof value === "string" && value.length > 0
    );

    if (!outputUri) {
      const failureResult = await failRenderJob(
        renderJob.id,
        "Runway completed without returning a video."
      );

      return failureResult && failureResult.failed
        ? {
            status: "failed" as const,
            progress: null
          }
        : reportEstimatedRenderProgress(renderJob, "in_progress");
    }

    const persistenceClaim = await db.renderJob.updateMany({
      where: {
        id: renderJob.id,
        status: {
          in: ["queued", "in_progress"]
        }
      },
      data: {
        providerOutputUri: outputUri,
        status: "in_progress",
        lastPolledAt: new Date()
      }
    });

    if (persistenceClaim.count !== 1) {
      return reportEstimatedRenderProgress(renderJob, "in_progress");
    }

    try {
      const buffer = await downloadRunwayVideo(outputUri);
      const saved = await persistVideoAsset(outputAssetId, buffer);
      const completed = await markRenderJobReady(
        renderJob.id,
        outputAssetId,
        {
          publicUrl: saved.publicUrl,
          storagePath: saved.storagePath,
          thumbnailUrl: saved.thumbnailUrl,
          sourceVideoId: providerRequestId
        }
      );

      return completed
        ? reportCompletedRenderProgress(renderJob)
        : reportEstimatedRenderProgress(renderJob, "in_progress");
    } catch (error) {
      const failureReason =
        error instanceof Error
          ? error.message
          : "Runway video download failed.";

      if (renderAgeMs < staleRunwayRenderMs) {
        console.warn("[render-job] completed Runway output is not downloadable yet", {
          sessionId: renderJob.sessionId,
          renderJobId: renderJob.id,
          failureReason
        });
        return reportEstimatedRenderProgress(renderJob, "in_progress");
      }

      const failureResult = await failRenderJob(renderJob.id, failureReason);
      return failureResult && failureResult.failed
        ? {
            status: "failed" as const,
            progress: null
          }
        : reportEstimatedRenderProgress(renderJob, "in_progress");
    }
  }

  const providerMessage = task.failure?.trim();
  const moderationBlocked =
    task.failureCode?.startsWith("SAFETY") ||
    isVideoModerationFailure(task.failureCode, providerMessage);
  const failureReason =
    providerMessage ||
    `Runway reported a ${task.status.toLowerCase()} render${
      task.failureCode ? ` (${task.failureCode})` : ""
    }.`;
  const failureResult = await failRenderJob(
    renderJob.id,
    moderationBlocked
      ? formatVideoModerationFailureReason(failureReason)
      : failureReason,
    {
      moderationBlocked
    }
  );

  return failureResult && failureResult.failed
    ? {
        status: "failed" as const,
        progress: null
      }
    : reportEstimatedRenderProgress(renderJob, "in_progress");
}

async function updateRunwayRenderStatus(
  renderJob: ProgressRenderJob,
  status: "queued" | "in_progress"
) {
  await db.renderJob.updateMany({
    where: {
      id: renderJob.id,
      status: {
        in: ["queued", "in_progress"]
      }
    },
    data: {
      status,
      lastPolledAt: new Date()
    }
  });
}

async function reportRunwayRenderProgress(
  renderJob: ProgressRenderJob,
  providerProgress: number
) {
  const progress = await recordRenderJobProgress(
    renderJob.sessionId,
    renderJob.id,
    Math.min(95, Math.max(0, Math.round(providerProgress * 100)))
  );

  return {
    status: "in_progress" as const,
    progress
  };
}

export async function failRenderJob(
  renderJobId: string,
  failureReason: string,
  options: {
    moderationBlocked?: boolean;
    forceRetry?: boolean;
  } = {}
) {
  const renderJob = await db.renderJob.findUnique({
    where: {
      id: renderJobId
    },
    select: {
      id: true,
      outputAssetId: true,
      submissionId: true,
      sessionId: true,
      status: true,
      submission: {
        select: {
          source: true,
          senderFingerprint: true
        }
      }
    }
  });

  if (!renderJob) {
    return false;
  }

  if (renderJob.status === "failed" || renderJob.status === "completed") {
    return {
      failed: renderJob.status === "failed",
      changed: false,
      moderationBlockCount: 0,
      banned: false
    };
  }

  const previousFailureCount =
    renderJob.submissionId && !options.moderationBlocked
      ? await db.renderJob.count({
          where: {
            submissionId: renderJob.submissionId,
            status: "failed",
            id: {
              not: renderJob.id
            }
          }
        })
      : 0;
  const retryExhausted =
    !options.moderationBlocked &&
    !options.forceRetry &&
    Boolean(renderJob.submissionId) &&
    previousFailureCount >= 1;

  const failureClaimed = await db.$transaction(async (tx: any) => {
    const failureClaim = await tx.renderJob.updateMany({
      where: {
        id: renderJob.id,
        status: {
          in: ["queued", "in_progress"]
        }
      },
      data: {
        status: "failed",
        failureReason,
        lastPolledAt: new Date()
      }
    });

    if (failureClaim.count !== 1) {
      return false;
    }

    if (renderJob.outputAssetId) {
      await tx.visualAsset.update({
        where: {
          id: renderJob.outputAssetId
        },
        data: {
          status: "failed"
        }
      });
    }

    if (renderJob.submissionId) {
      await tx.promptSubmission.update({
        where: {
          id: renderJob.submissionId
        },
        data: {
          status: options.moderationBlocked
            ? "rejected"
            : retryExhausted
              ? "failed"
              : "approved",
          selectedAt: null,
          ...(options.moderationBlocked
            ? {
                approvalReason: videoModerationBlockedReason
              }
            : {})
        }
      });
    }

    return true;
  });

  if (!failureClaimed) {
    return {
      failed: false,
      changed: false,
      moderationBlockCount: 0,
      banned: false
    };
  }

  let moderationBlockCount = 0;

  if (
    options.moderationBlocked &&
    renderJob.submission?.source === "web" &&
    renderJob.submission.senderFingerprint
  ) {
    const senderFingerprint = renderJob.submission.senderFingerprint;

    await recordAuditEvent({
      type: getParticipantModerationEventType(senderFingerprint),
      summary: "Counted a participant video-moderation block",
      details: renderJob.id,
      sessionId: renderJob.sessionId
    });

    moderationBlockCount = await getParticipantModerationBlockCount(
      renderJob.sessionId,
      senderFingerprint
    );

    console.info("[participant-moderation] counted video-moderation block", {
      sessionId: renderJob.sessionId,
      renderJobId: renderJob.id,
      moderationBlockCount,
      banned: isParticipantBanned(moderationBlockCount)
    });
  }

  return {
    failed: true,
    changed: true,
    moderationBlockCount,
    banned: isParticipantBanned(moderationBlockCount)
  };
}

export async function completeGeminiVideoRender(
  providerRequestId: string,
  outputUri: string
) {
  const renderJob = await db.renderJob.findUnique({
    where: {
      providerRequestId
    },
    include: {
      outputAsset: true,
      session: {
        include: {
          playbackState: true
        }
      }
    }
  });

  if (!renderJob || !renderJob.outputAsset) {
    return "missing" as const;
  }

  if (renderJob.status === "completed" || renderJob.status === "failed") {
    return renderJob.status;
  }

  const progressClaim = await db.renderJob.updateMany({
    where: {
      id: renderJob.id,
      status: {
        in: ["queued", "in_progress"]
      }
    },
    data: {
      providerOutputUri: outputUri,
      status: "in_progress",
      lastPolledAt: new Date()
    }
  });

  if (progressClaim.count !== 1) {
    return "in_progress" as const;
  }

  const apiKey = renderJob.session?.userId
    ? await getEffectiveGeminiApiKeyForUser(String(renderJob.session.userId))
    : null;

  if (!apiKey) {
    return "in_progress" as const;
  }

  const buffer = await resolveActiveVideoBuffer(outputUri, apiKey);

  if (!buffer) {
    return "in_progress" as const;
  }

  const saved = await persistVideoAsset(renderJob.outputAsset.id, buffer);

  const completed = await markRenderJobReady(renderJob.id, renderJob.outputAsset.id, {
    publicUrl: saved.publicUrl,
    storagePath: saved.storagePath,
    thumbnailUrl: saved.thumbnailUrl,
    sourceVideoId: providerRequestId
  });

  return completed ? ("completed" as const) : ("in_progress" as const);
}

export async function failGeminiVideoRender(
  providerRequestId: string,
  failureReason: string
) {
  const renderJob = await db.renderJob.findUnique({
    where: {
      providerRequestId
    },
    select: {
      id: true,
      status: true
    }
  });

  if (!renderJob || renderJob.status === "completed" || renderJob.status === "failed") {
    return false;
  }

  const failureResult = await failRenderJob(renderJob.id, failureReason);

  return Boolean(failureResult && failureResult.failed);
}

async function markRenderJobReady(
  renderJobId: string,
  assetId: string,
  input: {
    publicUrl: string;
    storagePath: string | null;
    thumbnailUrl?: string | null;
    sourceVideoId: string;
  }
) {
  const renderJob = await db.renderJob.findUnique({
    where: {
      id: renderJobId
    },
    include: {
      session: {
        include: {
          playbackState: true
        }
      },
      submission: true
    }
  });

  const playbackState = renderJob?.session.playbackState;

  if (
    !renderJob ||
    !playbackState ||
    renderJob.status === "completed" ||
    renderJob.status === "failed"
  ) {
    return false;
  }

  const placement = await db.$transaction(async (tx: any) => {
    const completionClaim = await tx.renderJob.updateMany({
      where: {
        id: renderJobId,
        status: {
          in: ["queued", "in_progress"]
        }
      },
      data: {
        status: "completed",
        failureReason: null,
        completedAt: new Date(),
        lastPolledAt: new Date()
      }
    });

    if (completionClaim.count !== 1) {
      return null;
    }

    await tx.visualAsset.update({
      where: {
        id: assetId
      },
      data: {
        status: "ready",
        publicUrl: input.publicUrl,
        storagePath: input.storagePath,
        ...(input.thumbnailUrl !== undefined
          ? {
              thumbnailUrl: input.thumbnailUrl
            }
          : {}),
        sourceVideoId: input.sourceVideoId
      }
    });

    const currentClaim = await tx.playbackState.updateMany({
      where: {
        id: playbackState.id,
        currentAssetId: null
      },
      data: {
        currentAssetId: assetId,
        status: "live",
        lastTransitionAt: new Date()
      }
    });
    let placement: "current" | "next" | "backlog" = "backlog";

    if (currentClaim.count === 1) {
      placement = "current";
      await tx.visualAsset.update({
        where: {
          id: assetId
        },
        data: {
          status: "live"
        }
      });
    } else {
      const promotedAssetId = await promoteOldestReadyAsset(renderJob.sessionId, tx, {
        allowArchivedRotation: false
      });

      if (promotedAssetId === assetId) {
        placement = "next";
      }
    }

    if (renderJob.submissionId) {
      await tx.promptSubmission.update({
        where: {
          id: renderJob.submissionId
        },
        data: {
          status: placement === "current" ? "live" : "ready"
        }
      });
    }

    return placement;
  });

  if (!placement) {
    return false;
  }

  console.info("[render-job] completed and placed asset", {
    sessionId: renderJob.sessionId,
    renderJobId,
    assetId,
    placement
  });

  return true;
}

async function callGeminiVideoApi<T>(url: string, apiKey: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json",
      "Api-Revision": geminiApiRevision,
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    let parsedCode: string | null = null;
    let parsedProviderMessage: string | null = null;

    try {
      const parsed = JSON.parse(errorText) as {
        error?: {
          message?: string;
          code?: string | number | null;
          status?: string | null;
        };
      };

      parsedProviderMessage = parsed.error?.message?.trim() ?? null;
      parsedCode = String(parsed.error?.status ?? parsed.error?.code ?? "").trim() || null;
    } catch {
      // Fall through to the plain-text response below.
    }

    const providerMessage = parsedProviderMessage || errorText.trim();
    const message = providerMessage
      ? `Gemini video request failed: ${providerMessage}${parsedCode ? ` (${parsedCode})` : ""}`
      : `Gemini video request failed with ${response.status}`;

    throw new GeminiVideoApiError(message, {
      code: parsedCode,
      moderationBlocked: isVideoModerationFailure(parsedCode, providerMessage),
      status: response.status
    });
  }

  return (await response.json()) as T;
}

async function retrieveGeminiVideoInteraction(
  interactionId: string,
  apiKey: string
) {
  const url = `${geminiInteractionsUrl}/${encodeURIComponent(interactionId)}`;

  try {
    return await callGeminiVideoApi<GeminiInteraction>(url, apiKey);
  } catch (error) {
    if (!(error instanceof GeminiVideoApiError) || error.status !== 400) {
      throw error;
    }

    console.warn("[render-job] standard Gemini lookup failed; trying event stream", {
      providerCode: error.code
    });

    return streamGeminiVideoInteraction(url, apiKey);
  }
}

async function streamGeminiVideoInteraction(url: string, apiKey: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  let completedInteraction: GeminiInteraction | null = null;
  let modelOutputVideo: GeminiVideoContent | null = null;

  try {
    const response = await fetch(`${url}?stream=true`, {
      headers: {
        "x-goog-api-key": apiKey,
        "Api-Revision": geminiApiRevision,
        Accept: "text/event-stream"
      },
      signal: controller.signal
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new GeminiVideoApiError(
        errorText.trim() ||
          `Gemini video event stream failed with ${response.status}`,
        {
          status: response.status
        }
      );
    }

    if (!response.body) {
      throw new Error("Gemini video event stream returned no response body.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";

    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const frames = pending.split(/\r?\n\r?\n/);
      pending = frames.pop() ?? "";

      for (const frame of frames) {
        const event = parseGeminiStreamFrame(frame);

        if (!event) {
          continue;
        }

        const streamedVideo = extractVideoFromStreamEvent(event);

        if (streamedVideo) {
          modelOutputVideo = streamedVideo;
        }

        if (event.event_type === "interaction.completed") {
          completedInteraction = {
            ...(event.interaction ?? {}),
            status: "completed",
            ...(modelOutputVideo
              ? {
                  steps: [
                    {
                      type: "model_output",
                      content: [modelOutputVideo]
                    }
                  ]
                }
              : {})
          };
          return completedInteraction;
        }

        if (
          event.event_type === "interaction.failed" ||
          event.event_type === "interaction.cancelled"
        ) {
          const status: GeminiInteraction["status"] =
            event.event_type === "interaction.cancelled"
              ? "cancelled"
              : "failed";

          return {
            ...(event.interaction ?? {}),
            status,
            error: event.error ?? event.interaction?.error ?? null
          };
        }
      }

      if (done) {
        break;
      }
    }

    return completedInteraction;
  } catch (error) {
    if (controller.signal.aborted) {
      return null;
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function parseGeminiStreamFrame(frame: string) {
  const data = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
    .trim();

  if (!data || data === "[DONE]") {
    return null;
  }

  try {
    return JSON.parse(data) as GeminiInteractionStreamEvent;
  } catch {
    return null;
  }
}

function extractVideoFromStreamEvent(event: GeminiInteractionStreamEvent) {
  if (event.step?.type === "model_output") {
    const content = event.step.content?.find(
      (item) =>
        item.type === "video" &&
        ("data" in item || "uri" in item)
    );

    if (content) {
      return content as GeminiVideoContent;
    }
  }

  if (
    event.delta?.type === "video" &&
    ("data" in event.delta || "uri" in event.delta)
  ) {
    return event.delta as GeminiVideoContent;
  }

  return extractVideoOutput(event.interaction ?? {});
}

async function fetchRemoteMedia(url: string, fallbackMimeType: string, label: string) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(remoteMediaDownloadTimeoutMs)
  });

  if (!response.ok) {
    throw new Error(`Could not download the ${label} for Gemini Omni (${response.status}).`);
  }

  const mimeType =
    response.headers.get("content-type")?.split(";")[0]?.trim() || fallbackMimeType;
  const data = Buffer.from(await response.arrayBuffer()).toString("base64");

  return {
    data,
    mimeType
  };
}

function extractVideoOutput(interaction: GeminiInteraction) {
  if (interaction.output_video?.data || interaction.output_video?.uri) {
    return interaction.output_video;
  }

  for (const step of interaction.steps ?? []) {
    if (step.type !== "model_output") {
      continue;
    }

    for (const content of step.content ?? []) {
      if (content.type === "video" && ("data" in content || "uri" in content)) {
        return content as GeminiVideoContent;
      }
    }
  }

  return null;
}

async function resolveVideoBuffer(video: GeminiVideoContent, apiKey: string) {
  if (video.data) {
    return Buffer.from(video.data, "base64");
  }

  if (!video.uri) {
    throw new Error("Gemini Omni returned an empty video output.");
  }

  const response = await fetch(video.uri, {
    headers: {
      "x-goog-api-key": apiKey,
      "Api-Revision": geminiApiRevision
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to download the completed Gemini Omni video (${response.status}).`);
  }

  return Buffer.from(await response.arrayBuffer());
}

async function resolveActiveVideoBuffer(outputUri: string, apiKey: string) {
  const fileMatch = outputUri.match(/(?:^|\/)files\/([^/:?]+)/);

  if (fileMatch?.[1]) {
    const fileResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/files/${encodeURIComponent(fileMatch[1])}`,
      {
        headers: {
          "x-goog-api-key": apiKey,
          "Api-Revision": geminiApiRevision
        }
      }
    );

    if (!fileResponse.ok) {
      throw new Error(
        `Failed to check the completed Gemini Omni video (${fileResponse.status}).`
      );
    }

    const file = (await fileResponse.json()) as {
      state?: string;
      error?: {
        message?: string;
      };
    };
    const state = file.state?.toUpperCase();

    if (state === "FAILED") {
      throw new Error(
        file.error?.message?.trim() || "Gemini Omni reported a failed video file."
      );
    }

    if (state && state !== "ACTIVE") {
      return null;
    }
  }

  const downloadUri = outputUri.startsWith("files/")
    ? `https://generativelanguage.googleapis.com/v1beta/${outputUri}:download?alt=media`
    : outputUri;

  return resolveVideoBuffer(
    {
      type: "video",
      uri: downloadUri
    },
    apiKey
  );
}

function getInteractionFailureMessage(interaction: GeminiInteraction) {
  const directMessage = interaction.error?.message?.trim();

  if (directMessage) {
    return directMessage;
  }

  for (const step of [...(interaction.steps ?? [])].reverse()) {
    for (const content of [...(step.content ?? [])].reverse()) {
      if ("text" in content && content.text?.trim()) {
        return content.text.trim();
      }
    }
  }

  if (interaction.incomplete_details) {
    return JSON.stringify(interaction.incomplete_details);
  }

  return null;
}

function isVideoModerationFailure(
  _code: string | number | null | undefined,
  message: string | null | undefined
) {
  if (!message) {
    return false;
  }

  const normalizedMessage = message.trim().toLowerCase();

  return /\bmoderation\b|\bmoderated\b|\bcontent (?:policy|safety)\b|\bsafety (?:policy|filter|reason)\b|\bblocked\b|\bfiltered\b|\bunsafe\b|\bprohibited\b/.test(
    normalizedMessage
  );
}

export function formatVideoModerationFailureReason(providerMessage?: string | null) {
  const detail = providerMessage?.trim();
  return detail ? `${videoModerationBlockedReason} ${detail}` : videoModerationBlockedReason;
}
