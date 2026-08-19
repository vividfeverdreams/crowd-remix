import { recordAuditEvent } from "@/lib/audit";
import { db } from "@/lib/db";
import { promoteOldestReadyAsset } from "@/lib/playback-queue";

type PlaybackTransitionResult = {
  changed: boolean;
  queuedAssetId: string | null;
  transitionedAssetId: string;
};

export const readyPlaybackStallMs = 15_000;

export function shouldRecoverReadyPlaybackAsset({
  readyAssetId,
  nextAssetId,
  readyAssetUpdatedAt,
  now = Date.now()
}: {
  readyAssetId: string;
  nextAssetId: string | null | undefined;
  readyAssetUpdatedAt: Date | string | null | undefined;
  now?: number;
}) {
  if (readyAssetId !== nextAssetId) {
    return true;
  }

  const readyAssetUpdatedTime = readyAssetUpdatedAt
    ? new Date(readyAssetUpdatedAt).getTime()
    : Number.NaN;

  return (
    !Number.isFinite(readyAssetUpdatedTime) ||
    now - readyAssetUpdatedTime >= readyPlaybackStallMs
  );
}

export async function takePlaybackAsset(sessionId: string, assetId: string) {
  return transitionPlaybackAsset(sessionId, assetId, false);
}

export async function completePlaybackTransition(
  sessionId: string,
  expectedNextAssetId?: string
) {
  if (expectedNextAssetId) {
    return transitionPlaybackAsset(sessionId, expectedNextAssetId, true);
  }

  const playback = await db.playbackState.findUnique({
    where: {
      sessionId
    },
    select: {
      nextAssetId: true
    }
  });

  if (!playback?.nextAssetId) {
    return null;
  }

  return transitionPlaybackAsset(sessionId, playback.nextAssetId, true);
}

async function transitionPlaybackAsset(
  sessionId: string,
  assetId: string,
  requireQueuedAsset: boolean
) {
  const result = await db.$transaction(async (tx: any) => {
    const playback = await tx.playbackState.findUnique({
      where: {
        sessionId
      }
    });

    if (!playback) {
      return null;
    }

    if (playback.currentAssetId === assetId) {
      return {
        changed: false,
        queuedAssetId: playback.nextAssetId,
        transitionedAssetId: assetId
      } satisfies PlaybackTransitionResult;
    }

    if (
      requireQueuedAsset &&
      playback.nextAssetId !== assetId
    ) {
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
        sourceSubmissionId: true
      }
    });

    if (!asset) {
      return null;
    }

    const transitionClaim = await tx.playbackState.updateMany({
      where: {
        id: playback.id,
        currentAssetId: playback.currentAssetId,
        nextAssetId: playback.nextAssetId
      },
      data: {
        currentAssetId: asset.id,
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
        id: asset.id
      },
      data: {
        status: "live"
      }
    });

    if (asset.sourceSubmissionId) {
      await tx.promptSubmission.update({
        where: {
          id: asset.sourceSubmissionId
        },
        data: {
          status: "live"
        }
      });
    }

    const queuedAssetId = await promoteOldestReadyAsset(sessionId, tx, {
      allowArchivedRotation: false
    });

    return {
      changed: true,
      queuedAssetId,
      transitionedAssetId: asset.id
    } satisfies PlaybackTransitionResult;
  });

  if (!result) {
    return null;
  }

  if (!result.changed) {
    console.info("[playback-transition] asset already live", {
      sessionId,
      transitionedAssetId: result.transitionedAssetId,
      queuedAssetId: result.queuedAssetId
    });
    return true;
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
