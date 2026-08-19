import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { completePlaybackTransition } from "@/lib/session-service";
import { attemptAutomatedSelection } from "@/lib/submission-pipeline";

type TransitionRouteProps = {
  params: Promise<{
    sessionId: string;
  }>;
};

export async function POST(request: Request, { params }: TransitionRouteProps) {
  const { sessionId } = await params;
  const body = (await request.json().catch(() => null)) as {
    assetId?: unknown;
  } | null;
  const assetId = typeof body?.assetId === "string" ? body.assetId.trim() : "";

  if (!assetId) {
    return NextResponse.json(
      {
        error: "A queued asset id is required."
      },
      {
        status: 400
      }
    );
  }

  const transitioned = await completePlaybackTransition(sessionId, assetId);

  console.info("[playback-transition] request completed", {
    sessionId,
    assetId,
    transitioned: Boolean(transitioned)
  });

  if (transitioned === true) {
    waitUntil(
      attemptAutomatedSelection(sessionId).catch((error: unknown) => {
        console.error("[playback-transition] automated selection failed", {
          sessionId,
          assetId,
          failureReason:
            error instanceof Error ? error.message : "Unknown automated selection error"
        });
      })
    );
  }

  return NextResponse.json({
    ok: true,
    transitioned: Boolean(transitioned)
  });
}
