import { db } from "@/lib/db";
import { normalizeVideoProgress } from "@/lib/render-progress";

export const renderProgressEventPrefix = "render.progress.";

export function getRenderProgressEventType(renderJobId: string) {
  return `${renderProgressEventPrefix}${renderJobId}`;
}

export function getStoredRenderProgress(
  events: Array<{
    type: string;
    details?: string | null;
  }>,
  renderJobId: string
) {
  const event = events.find(
    (candidate) => candidate.type === getRenderProgressEventType(renderJobId)
  );
  const progress = Number(event?.details);

  return event && Number.isFinite(progress) ? normalizeVideoProgress(progress) : null;
}

export async function recordRenderJobProgress(
  sessionId: string,
  renderJobId: string,
  progress: number
) {
  const type = getRenderProgressEventType(renderJobId);
  const existing = await db.auditEvent.findFirst({
    where: {
      sessionId,
      type
    },
    orderBy: {
      createdAt: "desc"
    }
  });
  const previousProgress = Number(existing?.details);
  const normalizedProgress = normalizeVideoProgress(
    progress,
    Number.isFinite(previousProgress) ? previousProgress : 0
  );

  if (existing) {
    await db.auditEvent.update({
      where: {
        id: existing.id
      },
      data: {
        details: String(normalizedProgress)
      }
    });
    return normalizedProgress;
  }

  await db.auditEvent.create({
    data: {
      sessionId,
      type,
      summary: "Updated video render progress",
      details: String(normalizedProgress)
    }
  });

  return normalizedProgress;
}
