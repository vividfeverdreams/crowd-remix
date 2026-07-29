import type { AudioSyncMessage } from "@/lib/audio-sync-channel";
import { getAudioSyncRelaySnapshot } from "@/lib/audio-sync-relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const preferredRegion = "iad1";
export const maxDuration = 60;

const relayPollIntervalMs = 100;
const streamLifetimeMs = 50000;

type AudioSyncStreamRouteProps = {
  params: Promise<{
    sessionId: string;
  }>;
};

export async function GET(request: Request, { params }: AudioSyncStreamRouteProps) {
  const { sessionId } = await params;
  const encoder = new TextEncoder();
  let interval: ReturnType<typeof setInterval> | undefined;
  let lifetime: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let pushing = false;
  let lastLiveStateId = "";
  let lastCueId = "";
  let lastTakeId = "";

  const clearTimers = () => {
    if (interval) {
      clearInterval(interval);
      interval = undefined;
    }

    if (lifetime) {
      clearTimeout(lifetime);
      lifetime = undefined;
    }
  };

  const stream = new ReadableStream({
    async start(controller) {
      const close = () => {
        if (closed) {
          return;
        }

        closed = true;
        clearTimers();
        controller.close();
      };

      const pushMessage = (message: AudioSyncMessage) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(message)}\n\n`));
      };

      const pushSnapshot = async () => {
        if (closed || pushing) {
          return;
        }

        pushing = true;

        try {
          const snapshot = await getAudioSyncRelaySnapshot(sessionId);

          if (closed) {
            return;
          }

          const liveStateId = snapshot.liveState
            ? `${snapshot.liveState.sourceId}:${snapshot.liveState.sentAt}:${snapshot.liveState.type}`
            : "";

          if (snapshot.liveState && liveStateId !== lastLiveStateId) {
            lastLiveStateId = liveStateId;
            pushMessage(snapshot.liveState);
          }

          const cueId = snapshot.cue?.type === "cue" ? snapshot.cue.eventId : "";

          if (snapshot.cue && cueId && cueId !== lastCueId) {
            lastCueId = cueId;
            pushMessage(snapshot.cue);
          }

          const takeId = snapshot.take?.type === "take" ? snapshot.take.eventId : "";

          if (snapshot.take && takeId && takeId !== lastTakeId) {
            lastTakeId = takeId;
            pushMessage(snapshot.take);
          }
        } catch (error) {
          clearTimers();
          closed = true;
          controller.error(error);
        } finally {
          pushing = false;
        }
      };

      request.signal.addEventListener("abort", close, {
        once: true
      });

      controller.enqueue(encoder.encode("retry: 500\n\n"));
      await pushSnapshot();

      if (closed) {
        return;
      }

      interval = setInterval(() => {
        void pushSnapshot();
      }, relayPollIntervalMs);
      lifetime = setTimeout(close, streamLifetimeMs);
    },
    cancel() {
      closed = true;
      clearTimers();
      return undefined;
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
}
