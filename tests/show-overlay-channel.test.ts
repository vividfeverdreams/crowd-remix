import { describe, expect, it } from "vitest";
import {
  defaultShowWordmarkOpacity,
  defaultShowWordmarkSize,
  getShowOverlaySettings,
  getShowQrOverlayVisibility,
  normalizeShowWordmarkOpacity,
  normalizeShowWordmarkSize,
  shouldShowNextRemixProgressOverlay,
  showQrOverlayDisabledEvent,
  showQrOverlayEnabledEvent,
  showQrOverlayEventTypes,
  showProgressOverlayDisabledEvent,
  showProgressOverlayEnabledEvent,
  showWordmarkAudioReactiveOnlyDisabledEvent,
  showWordmarkAudioReactiveOnlyEnabledEvent,
  showWordmarkOpacityEvent,
  showWordmarkSizeEvent,
  showWordmarkOverlayDisabledEvent,
  showWordmarkOverlayEnabledEvent
} from "@/lib/show-overlay-state";

describe("show overlay state", () => {
  it("lists both persisted QR overlay states", () => {
    expect(showQrOverlayEventTypes).toEqual([showQrOverlayEnabledEvent, showQrOverlayDisabledEvent]);
  });

  it("shows the overlay after the latest enable event", () => {
    expect(getShowQrOverlayVisibility(showQrOverlayEnabledEvent)).toBe(true);
  });

  it("hides the overlay after a disable event or before any command", () => {
    expect(getShowQrOverlayVisibility(showQrOverlayDisabledEvent)).toBe(false);
    expect(getShowQrOverlayVisibility(null)).toBe(false);
  });

  it("uses safe defaults before any wordmark settings are saved", () => {
    expect(getShowOverlaySettings([])).toEqual({
      qrOverlayVisible: false,
      wordmarkOverlayVisible: false,
      wordmarkOpacity: defaultShowWordmarkOpacity,
      wordmarkSize: defaultShowWordmarkSize,
      wordmarkAudioReactiveOnly: false,
      progressOverlayVisible: false
    });
  });

  it("uses the latest event for each independently persisted display setting", () => {
    expect(
      getShowOverlaySettings([
        {
          type: showWordmarkAudioReactiveOnlyEnabledEvent
        },
        {
          type: showProgressOverlayEnabledEvent
        },
        {
          type: showWordmarkOpacityEvent,
          details: "0.42"
        },
        {
          type: showWordmarkSizeEvent,
          details: "1.24"
        },
        {
          type: showWordmarkOverlayEnabledEvent
        },
        {
          type: showQrOverlayDisabledEvent
        },
        {
          type: showWordmarkAudioReactiveOnlyDisabledEvent
        },
        {
          type: showProgressOverlayDisabledEvent
        },
        {
          type: showWordmarkOverlayDisabledEvent
        },
        {
          type: showQrOverlayEnabledEvent
        }
      ])
    ).toEqual({
      qrOverlayVisible: false,
      wordmarkOverlayVisible: true,
      wordmarkOpacity: 0.42,
      wordmarkSize: 1.24,
      wordmarkAudioReactiveOnly: true,
      progressOverlayVisible: true
    });
  });

  it("normalizes opacity and rejects malformed persisted opacity", () => {
    expect(normalizeShowWordmarkOpacity(-1)).toBe(0);
    expect(normalizeShowWordmarkOpacity(0.456)).toBe(0.46);
    expect(normalizeShowWordmarkOpacity(2)).toBe(1);
    expect(
      getShowOverlaySettings([
        {
          type: showWordmarkOpacityEvent,
          details: "not-a-number"
        }
      ]).wordmarkOpacity
    ).toBe(defaultShowWordmarkOpacity);
  });

  it("normalizes wordmark size and rejects malformed persisted size", () => {
    expect(normalizeShowWordmarkSize(0.1)).toBe(0.3);
    expect(normalizeShowWordmarkSize(1.234)).toBe(1.23);
    expect(normalizeShowWordmarkSize(2)).toBe(1.5);
    expect(
      getShowOverlaySettings([
        {
          type: showWordmarkSizeEvent,
          details: "not-a-number"
        }
      ]).wordmarkSize
    ).toBe(defaultShowWordmarkSize);
  });

  it("only mounts the render-progress overlay while a render is active", () => {
    expect(shouldShowNextRemixProgressOverlay(true, true)).toBe(true);
    expect(shouldShowNextRemixProgressOverlay(true, false)).toBe(false);
    expect(shouldShowNextRemixProgressOverlay(false, true)).toBe(false);
  });
});
