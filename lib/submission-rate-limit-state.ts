export const submissionRateLimitConfiguredEvent = "session.submission_rate_limit.configured";
export const submissionRateLimitWindowMinutes = 10;
export const defaultSubmissionRateLimitCount = 3;

type SubmissionRateLimitEvent = {
  type: string;
  details?: string | null;
};

export type SubmissionRateLimitSettings = {
  enabled: boolean;
  count: number;
};

export function normalizeSubmissionRateLimitCount(value: number) {
  return Math.max(1, Math.min(20, Math.round(value)));
}

export function serializeSubmissionRateLimitSettings(settings: SubmissionRateLimitSettings) {
  return JSON.stringify({
    enabled: settings.enabled,
    count: normalizeSubmissionRateLimitCount(settings.count),
    windowMinutes: submissionRateLimitWindowMinutes
  });
}

export function getSubmissionRateLimitSettings(
  events: SubmissionRateLimitEvent[]
): SubmissionRateLimitSettings {
  const event = events.find((item) => item.type === submissionRateLimitConfiguredEvent);

  if (!event?.details) {
    return {
      enabled: false,
      count: defaultSubmissionRateLimitCount
    };
  }

  try {
    const stored = JSON.parse(event.details) as {
      enabled?: unknown;
      count?: unknown;
      windowMinutes?: unknown;
    };

    if (
      stored.enabled !== true ||
      typeof stored.count !== "number" ||
      stored.windowMinutes !== submissionRateLimitWindowMinutes
    ) {
      return {
        enabled: false,
        count: defaultSubmissionRateLimitCount
      };
    }

    return {
      enabled: true,
      count: normalizeSubmissionRateLimitCount(stored.count)
    };
  } catch {
    return {
      enabled: false,
      count: defaultSubmissionRateLimitCount
    };
  }
}
