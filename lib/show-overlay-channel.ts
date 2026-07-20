const showOverlayProtocolVersion = 1;

export type ShowQrOverlayMessage = {
  version: typeof showOverlayProtocolVersion;
  type: "qr-overlay";
  sessionId: string;
  visible: boolean;
  sentAt: number;
};

export function getShowOverlayChannelName(sessionId: string) {
  return `dream-sequence:show-overlay:${sessionId}`;
}

export function getShowQrOverlayStorageKey(sessionId: string) {
  return `dream-sequence:show-overlay:${sessionId}:qr-visible`;
}

export function createShowQrOverlayMessage(sessionId: string, visible: boolean): ShowQrOverlayMessage {
  return {
    version: showOverlayProtocolVersion,
    type: "qr-overlay",
    sessionId,
    visible,
    sentAt: Date.now()
  };
}

export function isShowQrOverlayMessage(value: unknown): value is ShowQrOverlayMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const message = value as Record<string, unknown>;

  return (
    message.version === showOverlayProtocolVersion &&
    message.type === "qr-overlay" &&
    typeof message.sessionId === "string" &&
    typeof message.visible === "boolean" &&
    typeof message.sentAt === "number" &&
    Number.isFinite(message.sentAt)
  );
}
