import { db } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { promoteOldestReadyAsset } from "@/lib/playback-queue";
import {
  normalizeShowWordmarkOpacity,
  normalizeShowWordmarkSize,
  showProgressOverlayDisabledEvent,
  showProgressOverlayEnabledEvent,
  showQrOverlayDisabledEvent,
  showQrOverlayEnabledEvent,
  showWordmarkAudioReactiveOnlyDisabledEvent,
  showWordmarkAudioReactiveOnlyEnabledEvent,
  showWordmarkOpacityEvent,
  showWordmarkSizeEvent,
  showWordmarkOverlayDisabledEvent,
  showWordmarkOverlayEnabledEvent
} from "@/lib/show-overlay-state";
import {
  serializeSubmissionRateLimitSettings,
  submissionRateLimitConfiguredEvent,
  submissionRateLimitWindowMinutes
} from "@/lib/submission-rate-limit-state";
import { createSessionCode, normalizePromptText } from "@/lib/utils";
import { queueAutomatedRender } from "@/lib/submission-pipeline";

type SessionInput = {
  name: string;
  artistName: string;
  trackName: string;
  creativeBible: string;
  allowedMotifs: string;
  bannedTerms: string;
  colorPalette: string;
  motionRules: string;
  basePrompt: string;
  imageReferenceUrl?: string;
  smsNumber?: string;
  venueSafeMode: boolean;
  artistControlEnabled: boolean;
  autoSelectEnabled: boolean;
  videoDurationSeconds: number;
  submissionRateLimitEnabled: boolean;
  submissionRateLimitCount: number;
};

export async function createDjSession(userId: string, input: SessionInput) {
  const code = createSessionCode(`${input.artistName}-${input.trackName}`);

  const session = await db.dJSession.create({
    data: {
      userId,
      code,
      name: input.name,
      artistName: input.artistName,
      trackName: input.trackName,
      creativeBible: normalizePromptText(input.creativeBible),
      allowedMotifs: input.allowedMotifs,
      bannedTerms: input.bannedTerms,
      colorPalette: input.colorPalette,
      motionRules: input.motionRules,
      basePrompt: normalizePromptText(input.basePrompt),
      imageReferenceUrl: input.imageReferenceUrl || null,
      smsNumber: input.smsNumber || null,
      venueSafeMode: input.venueSafeMode,
      artistControlEnabled: input.artistControlEnabled,
      autoSelectEnabled: input.autoSelectEnabled,
      videoDurationSeconds: input.videoDurationSeconds,
      playbackState: {
        create: {
          status: "idle"
        }
      }
    },
    include: {
      playbackState: true
    }
  });

  await recordAuditEvent({
    type: "session.created",
    summary: `Created session ${session.name}`,
    sessionId: session.id,
    userId
  });

  await recordAuditEvent({
    type: submissionRateLimitConfiguredEvent,
    summary: input.submissionRateLimitEnabled
      ? `Limited each device to ${input.submissionRateLimitCount} remixes per ${submissionRateLimitWindowMinutes} minutes`
      : "Left the device submission limit off",
    details: serializeSubmissionRateLimitSettings({
      enabled: input.submissionRateLimitEnabled,
      count: input.submissionRateLimitCount
    }),
    sessionId: session.id,
    userId
  });

  return session;
}

export async function getPrimarySessionForUser(userId: string) {
  return db.dJSession.findFirst({
    where: {
      userId
    },
    orderBy: {
      createdAt: "desc"
    },
    include: {
      playbackState: true
    }
  });
}

export async function startDjSession(sessionId: string, userId: string) {
  const ownedSession = await requireOwnedSession(sessionId, userId);

  const session = await db.dJSession.update({
    where: {
      id: ownedSession.id
    },
    data: {
      status: "live",
      startedAt: new Date(),
      stoppedAt: null,
      playbackState: {
        update: {
          status: "holding"
        }
      }
    },
    include: {
      playbackState: true,
      renderJobs: {
        where: {
          status: {
            in: ["queued", "in_progress"]
          }
        }
      }
    }
  });

  if (!session.playbackState?.currentAssetId && session.renderJobs.length === 0) {
    await queueAutomatedRender(session.id, null, "seed", session.basePrompt);
  }

  await recordAuditEvent({
    type: "session.started",
    summary: `Started session ${session.name}`,
    sessionId: session.id,
    userId
  });

  return session;
}

export async function stopDjSession(sessionId: string, userId: string) {
  const ownedSession = await requireOwnedSession(sessionId, userId);

  const session = await db.dJSession.update({
    where: {
      id: ownedSession.id
    },
    data: {
      status: "stopped",
      stoppedAt: new Date(),
      playbackState: {
        update: {
          emergencyPaused: true,
          status: "idle"
        }
      }
    }
  });

  await recordAuditEvent({
    type: "session.stopped",
    summary: `Stopped session ${session.name}`,
    sessionId: session.id,
    userId
  });

  return session;
}

export async function clearDjSession(sessionId: string, userId: string) {
  const ownedSession = await requireOwnedSession(sessionId, userId);

  await db.dJSession.delete({
    where: {
      id: ownedSession.id
    }
  });

  // The session row is gone, so the audit event cannot reference it.
  await recordAuditEvent({
    type: "session.cleared",
    summary: `Cleared session ${ownedSession.name} to start a new one`,
    userId
  });

  return ownedSession;
}

export async function setSelectionPause(sessionId: string, userId: string, paused: boolean) {
  const ownedSession = await requireOwnedSession(sessionId, userId);

  const session = await db.dJSession.update({
    where: {
      id: ownedSession.id
    },
    data: {
      autoSelectEnabled: !paused,
      playbackState: {
        update: {
          emergencyPaused: paused
        }
      }
    }
  });

  await recordAuditEvent({
    type: paused ? "session.paused" : "session.resumed",
    summary: paused ? "Paused automated prompt selection" : "Resumed automated prompt selection",
    sessionId,
    userId
  });

  return session;
}

export async function setShowQrOverlayVisibility(sessionId: string, userId: string, visible: boolean) {
  await requireOwnedSession(sessionId, userId);

  await recordAuditEvent({
    type: visible ? showQrOverlayEnabledEvent : showQrOverlayDisabledEvent,
    summary: visible ? "Showed the audience QR overlay" : "Hid the audience QR overlay",
    sessionId,
    userId
  });
}

export async function setShowWordmarkOverlayVisibility(sessionId: string, userId: string, visible: boolean) {
  await requireOwnedSession(sessionId, userId);

  await recordAuditEvent({
    type: visible ? showWordmarkOverlayEnabledEvent : showWordmarkOverlayDisabledEvent,
    summary: visible ? "Showed the centered wordmark overlay" : "Hid the centered wordmark overlay",
    sessionId,
    userId
  });
}

export async function setShowWordmarkOpacity(sessionId: string, userId: string, opacity: number) {
  await requireOwnedSession(sessionId, userId);

  const normalizedOpacity = normalizeShowWordmarkOpacity(opacity);

  await recordAuditEvent({
    type: showWordmarkOpacityEvent,
    summary: `Set the wordmark opacity to ${Math.round(normalizedOpacity * 100)}%`,
    details: String(normalizedOpacity),
    sessionId,
    userId
  });
}

export async function setShowWordmarkSize(sessionId: string, userId: string, size: number) {
  await requireOwnedSession(sessionId, userId);

  const normalizedSize = normalizeShowWordmarkSize(size);

  await recordAuditEvent({
    type: showWordmarkSizeEvent,
    summary: `Set the wordmark size to ${Math.round(normalizedSize * 100)}%`,
    details: String(normalizedSize),
    sessionId,
    userId
  });
}

export async function setShowWordmarkAudioReactiveOnly(
  sessionId: string,
  userId: string,
  wordmarkOnly: boolean
) {
  await requireOwnedSession(sessionId, userId);

  await recordAuditEvent({
    type: wordmarkOnly
      ? showWordmarkAudioReactiveOnlyEnabledEvent
      : showWordmarkAudioReactiveOnlyDisabledEvent,
    summary: wordmarkOnly
      ? "Applied audio-reactive VFX only to the wordmark"
      : "Applied audio-reactive VFX to the generated visuals",
    sessionId,
    userId
  });
}

export async function setShowProgressOverlayVisibility(
  sessionId: string,
  userId: string,
  visible: boolean
) {
  await requireOwnedSession(sessionId, userId);

  await recordAuditEvent({
    type: visible ? showProgressOverlayEnabledEvent : showProgressOverlayDisabledEvent,
    summary: visible
      ? "Showed the next-remix progress overlay"
      : "Hid the next-remix progress overlay",
    sessionId,
    userId
  });
}

export async function forceTransitionToNext(sessionId: string, userId: string) {
  const session = await db.dJSession.findFirst({
    where: {
      id: sessionId,
      userId
    },
    include: {
      playbackState: true
    }
  });

  if (!session?.playbackState?.nextAssetId) {
    return null;
  }

  return completePlaybackTransition(sessionId);
}

export async function cueHistoricalGeneration(sessionId: string, userId: string, assetId: string) {
  const selectedAsset = await db.$transaction(async (tx: any) => {
    const session = await tx.dJSession.findFirst({
      where: {
        id: sessionId,
        userId,
        status: "live"
      },
      select: {
        id: true,
        playbackState: {
          select: {
            id: true,
            currentAssetId: true
          }
        }
      }
    });

    if (!session?.playbackState || session.playbackState.currentAssetId === assetId) {
      return null;
    }

    const asset = await tx.visualAsset.findFirst({
      where: {
        id: assetId,
        sessionId,
        publicUrl: {
          not: null
        },
        status: {
          in: ["ready", "live", "archived"]
        }
      },
      select: {
        id: true,
        title: true,
        sourceSubmission: {
          select: {
            rawText: true,
            sender: true,
            source: true
          }
        }
      }
    });

    if (!asset) {
      return null;
    }

    await tx.visualAsset.update({
      where: {
        id: asset.id
      },
      data: {
        status: "ready"
      }
    });

    await tx.playbackState.update({
      where: {
        id: session.playbackState.id
      },
      data: {
        nextAssetId: asset.id,
        status: "live"
      }
    });

    return asset;
  });

  if (!selectedAsset) {
    return null;
  }

  await recordAuditEvent({
    type: "playback.history_cued",
    summary: "Queued a previous generation for immediate crossfade",
    details: `Selected visual asset ${selectedAsset.id}`,
    sessionId,
    userId
  });

  return selectedAsset;
}

export async function completePlaybackTransition(sessionId: string, expectedNextAssetId?: string) {
  const result = await db.$transaction(async (tx: any) => {
    const playback = await tx.playbackState.findUnique({
      where: {
        sessionId
      }
    });

    if (
      !playback?.nextAssetId ||
      (expectedNextAssetId && playback.nextAssetId !== expectedNextAssetId)
    ) {
      return null;
    }

    const transitionClaim = await tx.playbackState.updateMany({
      where: {
        id: playback.id,
        nextAssetId: playback.nextAssetId
      },
      data: {
        currentAssetId: playback.nextAssetId,
        nextAssetId: null,
        status: "live",
        lastTransitionAt: new Date()
      }
    });

    if (transitionClaim.count !== 1) {
      return null;
    }

    if (playback.currentAssetId) {
      await tx.visualAsset.update({
        where: {
          id: playback.currentAssetId
        },
        data: {
          status: "archived"
        }
      });
    }

    await tx.visualAsset.update({
      where: {
        id: playback.nextAssetId as string
      },
      data: {
        status: "live"
      }
    });

    const queuedAssetId = await promoteOldestReadyAsset(sessionId, tx);

    return {
      queuedAssetId,
      transitionedAssetId: playback.nextAssetId as string
    };
  });

  if (!result) {
    return null;
  }

  try {
    await recordAuditEvent({
      type: "playback.transitioned",
      summary: "Crossfaded to the queued visual asset",
      sessionId
    });
  } catch (error) {
    console.error("[playback-transition] audit logging failed", {
      sessionId,
      transitionedAssetId: result.transitionedAssetId,
      failureReason:
        error instanceof Error ? error.message : "Unknown audit logging error"
    });
  }

  console.info("[playback-transition] promoted live asset", {
    sessionId,
    transitionedAssetId: result.transitionedAssetId,
    queuedAssetId: result.queuedAssetId
  });

  return true;
}

export async function queueFallbackRemix(sessionId: string, userId: string) {
  const session = await db.dJSession.findFirst({
    where: {
      id: sessionId,
      userId
    }
  });

  if (!session) {
    return null;
  }

  const prompt = [
    session.basePrompt,
    "Shift the loop toward a calmer geometric pulse with resilient club-safe motion and a subtle palette reset.",
    "Keep the existing composition coherent and venue-safe."
  ].join(" ");

  await queueAutomatedRender(session.id, null, session.status === "live" ? "remix" : "seed", prompt);

  await recordAuditEvent({
    type: "session.fallback_remix",
    summary: "Queued a manual fallback remix",
    sessionId,
    userId
  });

  return true;
}

async function requireOwnedSession(sessionId: string, userId: string) {
  const session = await db.dJSession.findFirst({
    where: {
      id: sessionId,
      userId
    }
  });

  if (!session) {
    throw new Error("Session not found.");
  }

  return session;
}
