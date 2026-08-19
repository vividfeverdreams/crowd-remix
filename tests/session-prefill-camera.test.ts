import { describe, expect, it } from "vitest";
import {
  buildSessionDraftInputText,
  sessionDraftInstructions
} from "@/lib/session-prefill";

describe("session draft camera guidance", () => {
  it("preserves artist camera instructions and does not invent a restrictive default", () => {
    const input = buildSessionDraftInputText(
      "A chrome forest with violent dolly moves on every kick"
    );

    expect(sessionDraftInstructions).toContain(
      "Treat camera behavior as artist-directed"
    );
    expect(sessionDraftInstructions).toContain(
      "when camera behavior is unspecified, leave it open"
    );
    expect(input).toContain("camera directions, or motion preferences");
    expect(input).toContain(
      "If the user gave no camera direction, leave camera style unrestricted."
    );
    expect(input).toContain(
      'Session idea: "A chrome forest with violent dolly moves on every kick"'
    );
    expect(input).not.toContain("one seamless, wide");
  });

  it("retains loop and venue-safety guidance", () => {
    const input = buildSessionDraftInputText("A liquid prism world");

    expect(input).toContain("designed to loop seamlessly");
    expect(sessionDraftInstructions).toContain("Keep the draft venue-safe");
  });
});
