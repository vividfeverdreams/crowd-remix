import type { AudioCueKind } from "@/lib/audio-reactivity";
import { isAudioReactiveEffectId, type AudioReactiveEffectId } from "@/lib/audio-reactive-effects";
import type { AudioReactiveLevels } from "@/lib/use-audio-reactive-input";

const protocolVersion = 3;

type AudioSyncBaseMessage = {
  version: typeof protocolVersion;
  sessionId: string;
  sourceId: string;
  sentAt: number;
};

export type AudioSyncStateMessage = AudioSyncBaseMessage & {
  type: "state";
  connected: boolean;
  intensity: number;
  autoTakeOnCue: boolean;
  effect: AudioReactiveEffectId;
};

export type AudioSyncFrameMessage = AudioSyncBaseMessage & {
  type: "frame";
  connected: true;
  intensity: number;
  autoTakeOnCue: boolean;
  effect: AudioReactiveEffectId;
  levels: AudioReactiveLevels;
};

export type AudioSyncCueMessage = AudioSyncBaseMessage & {
  type: "cue";
  eventId: string;
  cue: AudioCueKind;
};

export type AudioSyncTakeMessage = AudioSyncBaseMessage & {
  type: "take";
  eventId: string;
  assetId?: string;
};

export type AudioSyncMessage =
  | AudioSyncStateMessage
  | AudioSyncFrameMessage
  | AudioSyncCueMessage
  | AudioSyncTakeMessage;

export function getAudioSyncChannelName(sessionId: string) {
  return `dream-sequence:audio-sync:${sessionId}`;
}

export function createAudioSyncBase(sessionId: string, sourceId: string): AudioSyncBaseMessage {
  return {
    version: protocolVersion,
    sessionId,
    sourceId,
    sentAt: Date.now()
  };
}

export function isAudioSyncMessage(value: unknown): value is AudioSyncMessage {
  if (!isRecord(value)) {
    return false;
  }

  if (
    value.version !== protocolVersion ||
    typeof value.sessionId !== "string" ||
    typeof value.sourceId !== "string" ||
    !isFiniteNumber(value.sentAt)
  ) {
    return false;
  }

  if (value.type === "state") {
    return (
      typeof value.connected === "boolean" &&
      isFiniteNumber(value.intensity) &&
      typeof value.autoTakeOnCue === "boolean" &&
      isAudioReactiveEffectId(value.effect)
    );
  }

  if (value.type === "frame") {
    return (
      value.connected === true &&
      isFiniteNumber(value.intensity) &&
      typeof value.autoTakeOnCue === "boolean" &&
      isAudioReactiveEffectId(value.effect) &&
      isAudioLevels(value.levels)
    );
  }

  if (value.type === "cue") {
    return (
      typeof value.eventId === "string" &&
      (value.cue === "build" || value.cue === "section-change")
    );
  }

  if (value.type === "take") {
    return (
      typeof value.eventId === "string" &&
      (value.assetId === undefined || typeof value.assetId === "string")
    );
  }

  return false;
}

function isAudioLevels(value: unknown): value is AudioReactiveLevels {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isFiniteNumber(value.energy) &&
    isFiniteNumber(value.bass) &&
    isFiniteNumber(value.mid) &&
    isFiniteNumber(value.high) &&
    isFiniteNumber(value.beatPulse)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
