import { describe, expect, it } from "vitest";
import {
  getSubmissionRateLimitSettings,
  serializeSubmissionRateLimitSettings,
  submissionRateLimitConfiguredEvent
} from "@/lib/submission-rate-limit-state";

describe("session submission rate-limit settings", () => {
  it("leaves sessions unlimited when no configuration exists", () => {
    expect(getSubmissionRateLimitSettings([])).toEqual({
      enabled: false,
      count: 3
    });
  });

  it("restores an enabled session limit", () => {
    expect(
      getSubmissionRateLimitSettings([
        {
          type: submissionRateLimitConfiguredEvent,
          details: serializeSubmissionRateLimitSettings({
            enabled: true,
            count: 7
          })
        }
      ])
    ).toEqual({
      enabled: true,
      count: 7
    });
  });

  it("fails open when stored configuration is malformed", () => {
    expect(
      getSubmissionRateLimitSettings([
        {
          type: submissionRateLimitConfiguredEvent,
          details: "{broken"
        }
      ])
    ).toEqual({
      enabled: false,
      count: 3
    });
  });
});
