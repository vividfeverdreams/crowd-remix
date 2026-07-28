export const showQrOverlayEnabledEvent = "show.qr_overlay.enabled";
export const showQrOverlayDisabledEvent = "show.qr_overlay.disabled";
export const showWordmarkOverlayEnabledEvent = "show.wordmark_overlay.enabled";
export const showWordmarkOverlayDisabledEvent = "show.wordmark_overlay.disabled";
export const showWordmarkOpacityEvent = "show.wordmark_overlay.opacity";
export const showWordmarkSizeEvent = "show.wordmark_overlay.size";
export const showWordmarkAudioReactiveOnlyEnabledEvent = "show.wordmark_audio_reactive_only.enabled";
export const showWordmarkAudioReactiveOnlyDisabledEvent = "show.wordmark_audio_reactive_only.disabled";
export const showProgressOverlayEnabledEvent = "show.progress_overlay.enabled";
export const showProgressOverlayDisabledEvent = "show.progress_overlay.disabled";

export const showQrOverlayEventTypes = [showQrOverlayEnabledEvent, showQrOverlayDisabledEvent] as const;
export const showOverlayEventTypes = [
  ...showQrOverlayEventTypes,
  showWordmarkOverlayEnabledEvent,
  showWordmarkOverlayDisabledEvent,
  showWordmarkOpacityEvent,
  showWordmarkSizeEvent,
  showWordmarkAudioReactiveOnlyEnabledEvent,
  showWordmarkAudioReactiveOnlyDisabledEvent,
  showProgressOverlayEnabledEvent,
  showProgressOverlayDisabledEvent
] as const;

export const defaultShowWordmarkOpacity = 0.85;
export const defaultShowWordmarkSize = 1;

type ShowOverlayEvent = {
  type: string;
  details?: string | null;
};

export function getShowQrOverlayVisibility(latestEventType: string | null | undefined) {
  return latestEventType === showQrOverlayEnabledEvent;
}

export function normalizeShowWordmarkOpacity(value: number) {
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
}

export function normalizeShowWordmarkSize(value: number) {
  return Math.round(Math.max(0.3, Math.min(1.5, value)) * 100) / 100;
}

export function shouldShowNextRemixProgressOverlay(
  enabled: boolean,
  hasActiveRender: boolean
) {
  return enabled && hasActiveRender;
}

export function getShowOverlaySettings(events: ShowOverlayEvent[]) {
  const qrEvent = events.find((event) => showQrOverlayEventTypes.some((type) => type === event.type));
  const wordmarkEvent = events.find(
    (event) => event.type === showWordmarkOverlayEnabledEvent || event.type === showWordmarkOverlayDisabledEvent
  );
  const opacityEvent = events.find((event) => event.type === showWordmarkOpacityEvent);
  const sizeEvent = events.find((event) => event.type === showWordmarkSizeEvent);
  const audioReactiveTargetEvent = events.find(
    (event) =>
      event.type === showWordmarkAudioReactiveOnlyEnabledEvent ||
      event.type === showWordmarkAudioReactiveOnlyDisabledEvent
  );
  const progressOverlayEvent = events.find(
    (event) =>
      event.type === showProgressOverlayEnabledEvent ||
      event.type === showProgressOverlayDisabledEvent
  );
  const storedOpacity = Number(opacityEvent?.details);
  const storedSize = Number(sizeEvent?.details);

  return {
    qrOverlayVisible: getShowQrOverlayVisibility(qrEvent?.type),
    wordmarkOverlayVisible: wordmarkEvent?.type === showWordmarkOverlayEnabledEvent,
    wordmarkOpacity: Number.isFinite(storedOpacity)
      ? normalizeShowWordmarkOpacity(storedOpacity)
      : defaultShowWordmarkOpacity,
    wordmarkSize: Number.isFinite(storedSize)
      ? normalizeShowWordmarkSize(storedSize)
      : defaultShowWordmarkSize,
    wordmarkAudioReactiveOnly:
      audioReactiveTargetEvent?.type === showWordmarkAudioReactiveOnlyEnabledEvent,
    progressOverlayVisible: progressOverlayEvent?.type === showProgressOverlayEnabledEvent
  };
}
