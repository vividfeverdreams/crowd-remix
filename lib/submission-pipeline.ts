import { db } from "@/lib/db";
import { assessSubmission } from "@/lib/ai-assessment";
import { checkSubmissionRateLimit } from "@/lib/rate-limit";
import { recordAuditEvent } from "@/lib/audit";
import { promoteOldestReadyAsset } from "@/lib/playback-queue";
import { hashValue, normalizePromptText } from "@/lib/utils";
import {
  completeGeminiVideoRender,
  failRenderJob,
  formatVideoModerationFailureReason,
  isVideoModerationError,
  reconcileRenderJob,
  startVideoRender
} from "@/lib/rendering";
import { getEffectiveGeminiApiKeyForUser } from "@/lib/google-key-store";
import {
  assessSubmissionImage,
  participantImageModerationBlockedReason,
  type ImageModerationAssessment
} from "@/lib/image-moderation";
import {
  getParticipantModerationBlockCount,
  getParticipantModerationEventType,
  getParticipantBlocksRemaining,
  isParticipantBanned,
  participantModerationBanThreshold
} from "@/lib/participant-session";
import { persistSubmissionImage } from "@/lib/storage";
import type { ValidatedSubmissionImage } from "@/lib/submission-image";
import {
  getSubmissionRateLimitSettings,
  submissionRateLimitConfiguredEvent
} from "@/lib/submission-rate-limit-state";
import { normalizeVideoDurationSeconds } from "@/lib/video-duration";

type IntakeInput = {
  sessionCode: string;
  source: "sms" | "web";
  prompt: string;
  sender?: string | null;
  senderFingerprintSeed: string;
  participantToken?: string | null;
  messageSid?: string | null;
  referenceImage?: ValidatedSubmissionImage | null;
};

export async function ingestSubmission(input: IntakeInput) {
  if (input.messageSid) {
    const existing = await db.promptSubmission.findUnique({
      where: {
        messageSid: input.messageSid
      }
    });

    if (existing) {
      return {
        status: "approved" as const,
        message: "That remix text is already in the mix.",
        submissionId: existing.id
      };
    }
  }

  const session = await db.dJSession.findUnique({
    where: {
      code: input.sessionCode
    },
    include: {
      playbackState: true,
      auditEvents: {
        where: {
          type: submissionRateLimitConfiguredEvent
        },
        orderBy: {
          createdAt: "desc"
        },
        take: 1
      },
      submissions: {
        where: {
          status: {
            in: ["approved", "ready", "live"]
          }
        },
        include: {
          rankingResult: true
        },
        orderBy: {
          createdAt: "desc"
        },
        take: 8
      }
    }
  });

  if (!session) {
    throw new Error("Session not found.");
  }

  if (session.status !== "live") {
    throw new Error("This session is not live yet.");
  }

  const senderFingerprintSeed =
    input.source === "web" ? input.participantToken?.trim() : input.senderFingerprintSeed;

  if (input.source === "web" && (!senderFingerprintSeed || !input.sender?.trim())) {
    throw new Error("Choose a nickname before sending your remix.");
  }

  const senderFingerprint = hashValue(`${session.id}:${senderFingerprintSeed}`);

  if (input.source === "web") {
    const moderationBlockCount = await getParticipantModerationBlockCount(
      session.id,
      senderFingerprint
    );

    if (isParticipantBanned(moderationBlockCount)) {
      return {
        status: "banned" as const,
        message: `This device is locked out for the rest of this live sequence after ${participantModerationBanThreshold} media-moderation blocks.`,
        moderationBlockCount
      };
    }
  }

  const submissionRateLimit = getSubmissionRateLimitSettings(session.auditEvents);
  const rateLimit = await checkSubmissionRateLimit(
    session.id,
    senderFingerprint,
    submissionRateLimit.enabled ? submissionRateLimit.count : null
  );

  if (!rateLimit.allowed) {
    return {
      status: "rate-limited" as const,
      message: rateLimit.reason ?? "Please wait before sending another remix."
    };
  }

  const normalizedText = normalizePromptText(input.prompt);
  const recentWinningPrompts = session.submissions
    .map((item: any) => item.rankingResult?.winningPrompt)
    .filter((value: any): value is string => Boolean(value));
  const [assessment, imageAssessment] = await Promise.all([
    assessSubmission({
      submissionText: session.artistControlEnabled
        ? normalizedText
        : input.prompt.trim(),
      session,
      recentWinningPrompts
    }),
    input.referenceImage
      ? assessSubmissionImage({
          image: input.referenceImage,
          userId: String(session.userId)
        })
      : Promise.resolve<ImageModerationAssessment | null>(null)
  ]);
  const imageRejected = imageAssessment?.decision === "rejected";
  const decision = imageRejected ? "rejected" : assessment.decision;
  const approvalReason = imageRejected
    ? imageAssessment.explanation
    : assessment.approvalReason;
  const moderationFlags = imageRejected
    ? [...new Set([...assessment.flags, ...imageAssessment.flags])]
    : assessment.flags;
  const moderationExplanation = imageAssessment
    ? `${imageAssessment.explanation} ${assessment.explanation}`
    : assessment.explanation;
  const storedImage =
    input.referenceImage && decision === "approved"
      ? await persistSubmissionImage(session.id, input.referenceImage)
      : null;

  const submission = await db.promptSubmission.create({
    data: {
      sessionId: session.id,
      source: input.source,
      sender: input.sender ? normalizePromptText(input.sender) : null,
      senderFingerprint,
      messageSid: input.messageSid || null,
      rawText: input.prompt,
      normalizedText,
      referenceImageUrl: storedImage?.publicUrl ?? null,
      referenceImageStoragePath: storedImage?.storagePath ?? null,
      referenceImageMimeType:
        storedImage && input.referenceImage
          ? input.referenceImage.mimeType
          : null
    }
  });

  await db.$transaction(async (tx: any) => {
    await tx.moderationResult.create({
      data: {
        submissionId: submission.id,
        decision,
        score: imageRejected ? 0 : assessment.score,
        flags: JSON.stringify(moderationFlags),
        explanation: moderationExplanation
      }
    });

    await tx.rankingResult.create({
      data: {
        submissionId: submission.id,
        score: imageRejected ? 0 : assessment.score,
        noveltyScore: imageRejected ? 0 : assessment.noveltyScore,
        cohesionScore: imageRejected ? 0 : assessment.cohesionScore,
        remixDeltaScore: imageRejected ? 0 : assessment.remixDeltaScore,
        winningPrompt: imageRejected ? input.prompt.trim() : assessment.winningPrompt,
        explanation: approvalReason
      }
    });

    await tx.promptSubmission.update({
      where: {
        id: submission.id
      },
      data: {
        status: decision === "approved" ? "approved" : "rejected",
        approvalReason
      }
    });
  });

  await recordAuditEvent({
    type: decision === "approved" ? "submission.approved" : "submission.rejected",
    summary: `Processed ${input.source} submission`,
    details: moderationExplanation,
    sessionId: session.id
  });

  if (imageRejected) {
    await recordAuditEvent({
      type: getParticipantModerationEventType(senderFingerprint),
      summary: "Counted a participant image-moderation block",
      details: `${participantImageModerationBlockedReason} ${imageAssessment.flags.join(", ")}`,
      sessionId: session.id
    });
    const moderationBlockCount = await getParticipantModerationBlockCount(
      session.id,
      senderFingerprint
    );
    const banned = isParticipantBanned(moderationBlockCount);
    const blocksRemaining = getParticipantBlocksRemaining(
      moderationBlockCount
    );

    return {
      status: banned ? ("banned" as const) : ("rejected" as const),
      message: banned
        ? "This was the third blocked image or video, so this device is locked for the rest of the live sequence."
        : `That photo did not pass venue-safe image moderation. ${blocksRemaining} ${
            blocksRemaining === 1 ? "strike" : "strikes"
          } remaining before this device is locked.`,
      submissionId: submission.id,
      moderationBlockCount,
      blocksRemaining
    };
  }

  if (decision === "approved") {
    await attemptAutomatedSelection(session.id);
  }

  return {
    status: decision,
    message:
      decision === "approved"
        ? session.artistControlEnabled
          ? "Your remix is in the mix. Venue-safe AI is scoring the queue now."
          : "Your remix is queued exactly as written."
        : "That idea did not pass the venue-safe remix filter.",
    submissionId: submission.id
  };
}

export async function attemptAutomatedSelection(sessionId: string) {
  const session = await db.dJSession.findUnique({
    where: {
      id: sessionId
    },
    include: {
      playbackState: true,
      renderJobs: {
        where: {
          status: {
            in: ["queued", "in_progress"]
          }
        }
      },
      visualAssets: {
        where: {
          status: "ready",
          publicUrl: {
            not: null
          }
        },
        select: {
          id: true
        },
        take: 1
      },
      submissions: {
        where: {
          status: "approved",
          selectedAt: null
        },
        include: {
          rankingResult: true
        },
        orderBy: {
          createdAt: "asc"
        }
      }
    }
  });

  if (!session?.playbackState) {
    return null;
  }

  if (!session.autoSelectEnabled || session.playbackState.emergencyPaused) {
    return null;
  }

  if (session.renderJobs.length > 0 || session.visualAssets.length > 0) {
    return null;
  }

  const promotedAssetId = await promoteOldestReadyAsset(sessionId);

  if (promotedAssetId) {
    console.info("[playback-queue] staged rotation asset", {
      sessionId,
      assetId: promotedAssetId
    });
  }

  const nextSubmission = [...session.submissions]
    .filter((submission) => submission.rankingResult)
    .sort((left, right) => (right.rankingResult?.score ?? 0) - (left.rankingResult?.score ?? 0))[0];

  if (!nextSubmission?.rankingResult) {
    return null;
  }

  await db.promptSubmission.update({
    where: {
      id: nextSubmission.id
    },
    data: {
      status: "queued",
      selectedAt: new Date()
    }
  });

  return queueAutomatedRender(sessionId, nextSubmission.id, session.playbackState.currentAssetId ? "remix" : "seed", nextSubmission.rankingResult.winningPrompt);
}

export async function queueAutomatedRender(
  sessionId: string,
  submissionId: string | null,
  requestedMode: "seed" | "remix",
  promptText: string
) {
  const [session, sourceSubmission] = await Promise.all([
    db.dJSession.findUnique({
      where: {
        id: sessionId
      },
      include: {
        playbackState: true,
        renderJobs: {
          where: {
            status: {
              in: ["queued", "in_progress"]
            }
          }
        },
        visualAssets: {
          where: {
            status: {
              in: ["live", "ready"]
            }
          },
          orderBy: {
            createdAt: "desc"
          }
        }
      }
    }),
    submissionId
      ? db.promptSubmission.findUnique({
          where: {
            id: submissionId
          },
          select: {
            referenceImageUrl: true
          }
        })
      : Promise.resolve(null)
  ]);

  if (!session?.playbackState) {
    return null;
  }

  if (
    session.renderJobs.length > 0 ||
    session.visualAssets.some((asset: any) => asset.status === "ready")
  ) {
    return null;
  }

  const sourceAsset =
    session.visualAssets.find((asset: any) => asset.status === "live") ?? null;
  const canEditExistingVideo =
    requestedMode === "remix" &&
    Boolean(sourceAsset?.publicUrl);

  if (requestedMode === "remix" && !canEditExistingVideo) {
    await recordAuditEvent({
      type: "render.source_missing",
      summary: "Skipped a remix because no source video was available",
      details: promptText,
      sessionId
    });
    return null;
  }

  const mode = requestedMode;
  const durationSeconds = normalizeVideoDurationSeconds(
    session.videoDurationSeconds
  );

  const outputAsset = await db.visualAsset.create({
    data: {
      sessionId,
      sourceSubmissionId: submissionId,
      kind: mode,
      title: mode === "seed" ? "Seed Loop" : "DREAM SEQUENCE",
      promptText,
      durationSeconds,
      status: "processing"
    }
  });

  const renderJob = await db.renderJob.create({
    data: {
      sessionId,
      submissionId,
      sourceAssetId: sourceAsset?.id ?? null,
      outputAssetId: outputAsset.id,
      mode,
      status: "queued",
      promptText
    }
  });

  const geminiApiKey = session.userId
    ? await getEffectiveGeminiApiKeyForUser(String(session.userId))
    : null;

  let started;

  try {
    started = await startVideoRender({
      mode,
      prompt: promptText,
      sourceVideoId: sourceAsset?.sourceVideoId,
      sourceVideoUrl: sourceAsset?.publicUrl,
      imageReferenceUrl: session.imageReferenceUrl,
      remixReferenceImageUrl:
        mode === "remix"
          ? sourceSubmission?.referenceImageUrl
          : null,
      geminiApiKey,
      durationSeconds
    });
  } catch (error) {
    const failureReason =
      error instanceof Error ? error.message : "Render could not be started.";
    const moderationBlocked = isVideoModerationError(error);

    await failRenderJob(
      renderJob.id,
      moderationBlocked
        ? formatVideoModerationFailureReason(failureReason)
        : failureReason,
      {
        moderationBlocked
      }
    );

    await recordAuditEvent({
      type: moderationBlocked ? "render.moderation_blocked" : "render.start_failed",
      summary: moderationBlocked
        ? "Gemini Omni moderation blocked a remix before rendering"
        : "Could not start a remix render",
      details: failureReason,
      sessionId
    });

    return null;
  }

  if (started.kind === "demo") {
    await db.renderJob.update({
      where: {
        id: renderJob.id
      },
      data: {
        providerRequestId: started.videoId,
        status: "completed"
      }
    });

    await reconcileRenderJob(renderJob.id);
    return renderJob;
  }

  await db.renderJob.update({
    where: {
      id: renderJob.id
    },
    data: {
      providerRequestId: started.requestId,
      providerOutputUri: started.outputUri,
      providerStrategy: started.strategy,
      status: "queued"
    }
  });

  if (started.outputUri) {
    await completeGeminiVideoRender(started.requestId, started.outputUri);
  }

  return renderJob;
}

export async function reconcilePendingRenderJobs(sessionId: string) {
  const jobs = await db.renderJob.findMany({
    where: {
      sessionId,
      status: {
        in: ["queued", "in_progress"]
      }
    },
    orderBy: {
      createdAt: "asc"
    }
  });

  const updates = [];

  for (const job of jobs) {
    const update = await reconcileRenderJob(job.id);

    updates.push({
      id: job.id,
      status: update?.status ?? job.status,
      progress: update?.progress ?? null
    });
  }

  // A render can finish after crowd prompts arrived while its slot was busy.
  // Re-open selection here so those approved prompts do not wait forever,
  // especially after the initial seed becomes the current live asset.
  await attemptAutomatedSelection(sessionId);

  return updates;
}
