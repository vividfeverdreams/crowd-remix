import { describe, expect, it } from "vitest";
import {
  createShowQrOverlayMessage,
  getShowOverlayChannelName,
  getShowQrOverlayStorageKey,
  isShowQrOverlayMessage
} from "@/lib/show-overlay-channel";

describe("show overlay channel", () => {
  it("scopes live state and storage to a single session", () => {
    expect(getShowOverlayChannelName("session-123")).toBe("dream-sequence:show-overlay:session-123");
    expect(getShowQrOverlayStorageKey("session-123")).toBe(
      "dream-sequence:show-overlay:session-123:qr-visible"
    );
  });

  it("accepts a valid QR overlay update", () => {
    expect(isShowQrOverlayMessage(createShowQrOverlayMessage("session-123", true))).toBe(true);
  });

  it("rejects malformed overlay messages", () => {
    expect(
      isShowQrOverlayMessage({
        version: 1,
        type: "qr-overlay",
        sessionId: "session-123",
        visible: "yes",
        sentAt: Date.now()
      })
    ).toBe(false);
  });
});
