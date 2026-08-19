import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { getCurrentUser } from "@/lib/auth";
import {
  completePlaybackTransition,
  cueHistoricalGeneration,
  forceTransitionToNext,
  queueFallbackRemix,
  setSelectionPause,
  setShowProgressOverlayVisibility,
  setShowQrOverlayVisibility,
  setShowWordmarkAudioReactiveOnly,
  setShowWordmarkOpacity,
  setShowWordmarkSize,
  setShowWordmarkOverlayVisibility,
  stopDjSession
} from "@/lib/session-service";
import { attemptAutomatedSelection } from "@/lib/submission-pipeline";
import { controlSchema } from "@/lib/schemas";
import { createAudioSyncBase, type AudioSyncTakeMessage } from "@/lib/audio-sync-channel";
import { publishAudioSyncMessage } from "@/lib/audio-sync-relay";

type ControlRouteProps = {
  params: Promise<{
    sessionId: string;
  }>;
};

export async function POST(request: Request, { params }: ControlRouteProps) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json(
      {
        error: "Unauthorized"
      },
      {
        status: 401
      }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = controlSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Unknown control action."
      },
      {
        status: 400
      }
    );
  }

  const { sessionId } = await params;

  switch (parsed.data.action) {
    case "pause-selection":
      await setSelectionPause(sessionId, user.id, true);
      break;
    case "resume-selection":
      await setSelectionPause(sessionId, user.id, false);
      await attemptAutomatedSelection(sessionId);
      break;
    case "skip-next":
      await forceTransitionToNext(sessionId, user.id);
      await attemptAutomatedSelection(sessionId);
      break;
    case "fallback-remix":
      await queueFallbackRemix(sessionId, user.id);
      break;
    case "cue-generation": {
      const selectedAsset = await cueHistoricalGeneration(sessionId, user.id, parsed.data.assetId);

      if (!selectedAsset) {
        return NextResponse.json(
          {
            error: "That generation is unavailable or already live."
          },
          {
            status: 409
          }
        );
      }

      const takeMessage: AudioSyncTakeMessage = {
        ...createAudioSyncBase(sessionId, `history-control:${user.id}`),
        type: "take",
        eventId: `history:${selectedAsset.id}:${Date.now()}`,
        assetId: selectedAsset.id
      };

      const transitioned = await completePlaybackTransition(
        sessionId,
        selectedAsset.id
      );

      if (!transitioned) {
        return NextResponse.json(
          {
            error: "That generation could not become the live video."
          },
          {
            status: 409
          }
        );
      }

      try {
        await publishAudioSyncMessage(takeMessage);
      } catch (error) {
        console.error("[manual-generation] take relay failed after promotion", {
          sessionId,
          assetId: selectedAsset.id,
          failureReason:
            error instanceof Error ? error.message : "Unknown take relay error"
        });
      }

      waitUntil(
        attemptAutomatedSelection(sessionId).catch((error: unknown) => {
          console.error("[manual-generation] automated selection failed", {
            sessionId,
            assetId: selectedAsset.id,
            failureReason:
              error instanceof Error
                ? error.message
                : "Unknown automated selection error"
          });
        })
      );

      console.info("[manual-generation] promoted historical asset and sent take", {
        sessionId,
        assetId: selectedAsset.id,
        hasUserPrompt: Boolean(selectedAsset.sourceSubmission?.rawText)
      });

      return NextResponse.json({
        ok: true,
        assetId: selectedAsset.id
      });
    }
    case "set-qr-overlay":
      await setShowQrOverlayVisibility(sessionId, user.id, parsed.data.value);
      break;
    case "set-wordmark-overlay":
      await setShowWordmarkOverlayVisibility(sessionId, user.id, parsed.data.value);
      break;
    case "set-wordmark-opacity":
      await setShowWordmarkOpacity(sessionId, user.id, parsed.data.value);
      break;
    case "set-wordmark-size":
      await setShowWordmarkSize(sessionId, user.id, parsed.data.value);
      break;
    case "set-wordmark-audio-reactive-only":
      await setShowWordmarkAudioReactiveOnly(sessionId, user.id, parsed.data.value);
      break;
    case "set-progress-overlay":
      await setShowProgressOverlayVisibility(sessionId, user.id, parsed.data.value);
      break;
    case "stop-session":
      await stopDjSession(sessionId, user.id);
      break;
  }

  return NextResponse.json({
    ok: true
  });
}
