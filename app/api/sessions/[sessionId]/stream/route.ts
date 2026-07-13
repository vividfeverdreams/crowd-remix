import { getSessionSnapshot } from "@/lib/snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const snapshotIntervalMs = 3000;
const streamLifetimeMs = 50000;

type StreamRouteProps = {
  params: Promise<{
    sessionId: string;
  }>;
};

export async function GET(request: Request, { params }: StreamRouteProps) {
  const { sessionId } = await params;
  const encoder = new TextEncoder();
  let interval: ReturnType<typeof setInterval> | undefined;
  let lifetime: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let pushing = false;

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

      const pushSnapshot = async () => {
        if (closed || pushing) {
          return;
        }

        pushing = true;

        try {
          const snapshot = await getSessionSnapshot(sessionId);

          if (closed) {
            return;
          }

          if (!snapshot) {
            controller.enqueue(encoder.encode("event: close\ndata: {}\n\n"));
            close();
            return;
          }

          controller.enqueue(encoder.encode(`data: ${JSON.stringify(snapshot)}\n\n`));
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

      controller.enqueue(encoder.encode("retry: 1000\n\n"));
      await pushSnapshot();

      if (closed) {
        return;
      }

      interval = setInterval(() => {
        void pushSnapshot();
      }, snapshotIntervalMs);

      // Vercel terminates long-lived functions at their duration limit. End the
      // response first so EventSource reconnects cleanly instead of producing a
      // runtime timeout every five minutes.
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
