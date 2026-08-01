"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import {
  getAudioSyncChannelName,
  isAudioSyncMessage,
  type AudioSyncMessage
} from "@/lib/audio-sync-channel";
import { defaultAudioReactiveEffect, type AudioReactiveEffectId } from "@/lib/audio-reactive-effects";
import type { AudioCueKind } from "@/lib/audio-reactivity";
import type { AudioReactiveLevels } from "@/lib/use-audio-reactive-input";

export type RemoteAudioCue = {
  id: string;
  kind: AudioCueKind;
  occurredAt: number;
};

const silentLevels: AudioReactiveLevels = {
  energy: 0,
  bass: 0,
  mid: 0,
  high: 0,
  beatPulse: 0
};

const dashboardTimeoutMs = 1800;
const replayGraceMs = 250;

export function useShowAudioSync(sessionId: string) {
  const levelsRef = useRef<AudioReactiveLevels>({ ...silentLevels });
  const lastMessageAtRef = useRef(0);
  const mountedAtRef = useRef(Date.now());
  const lastCueIdRef = useRef("");
  const lastTakeIdRef = useRef("");
  const [connected, setConnected] = useState(false);
  const [intensity, setIntensity] = useState(0.85);
  const [autoTakeOnCue, setAutoTakeOnCue] = useState(false);
  const [effect, setEffect] = useState<AudioReactiveEffectId>(defaultAudioReactiveEffect);
  const [lastCue, setLastCue] = useState<RemoteAudioCue | null>(null);
  const [manualTakeRequestId, setManualTakeRequestId] = useState<string | null>(null);
  const [manualTakeAssetId, setManualTakeAssetId] = useState<string | null>(null);

  useEffect(() => {
    const handleMessage = (message: AudioSyncMessage) => {
      if (message.sessionId !== sessionId) {
        return;
      }

      if (message.type === "frame") {
        if (Date.now() - message.sentAt > dashboardTimeoutMs) {
          return;
        }

        lastMessageAtRef.current = Date.now();
        levelsRef.current = message.levels;
        setConnected(true);
        setIntensity(message.intensity);
        setAutoTakeOnCue(message.autoTakeOnCue);
        setEffect(message.effect);
        return;
      }

      if (message.type === "state") {
        if (message.connected && Date.now() - message.sentAt > dashboardTimeoutMs) {
          return;
        }

        lastMessageAtRef.current = Date.now();
        setConnected(message.connected);
        setIntensity(message.intensity);
        setAutoTakeOnCue(message.autoTakeOnCue);
        setEffect(message.effect);

        if (!message.connected) {
          levelsRef.current = { ...silentLevels };
        }
        return;
      }

      if (message.sentAt < mountedAtRef.current - replayGraceMs) {
        return;
      }

      if (message.type === "cue") {
        if (message.eventId === lastCueIdRef.current) {
          return;
        }

        lastCueIdRef.current = message.eventId;
        setLastCue({
          id: message.eventId,
          kind: message.cue,
          occurredAt: message.sentAt
        });
        return;
      }

      if (message.eventId === lastTakeIdRef.current) {
        return;
      }

      lastTakeIdRef.current = message.eventId;
      setManualTakeAssetId(message.assetId ?? null);
      setManualTakeRequestId(message.eventId);
    };

    const handleUnknownMessage = (value: unknown) => {
      if (isAudioSyncMessage(value)) {
        handleMessage(value);
      }
    };

    const channel = "BroadcastChannel" in window
      ? new BroadcastChannel(getAudioSyncChannelName(sessionId))
      : null;
    const relayStream = new EventSource(`/api/sessions/${sessionId}/audio-sync/stream`);

    if (channel) {
      channel.onmessage = (event: MessageEvent<unknown>) => {
        handleUnknownMessage(event.data);
      };
    }

    relayStream.onmessage = (event) => {
      try {
        handleUnknownMessage(JSON.parse(event.data));
      } catch {
        // EventSource reconnects automatically if a relay response is interrupted.
      }
    };

    const watchdog = window.setInterval(() => {
      if (lastMessageAtRef.current && Date.now() - lastMessageAtRef.current > dashboardTimeoutMs) {
        lastMessageAtRef.current = 0;
        levelsRef.current = { ...silentLevels };
        setConnected(false);
      }
    }, 600);

    return () => {
      window.clearInterval(watchdog);
      channel?.close();
      relayStream.close();
      levelsRef.current = { ...silentLevels };
    };
  }, [sessionId]);

  return {
    autoTakeOnCue,
    connected,
    effect,
    intensity,
    lastCue,
    levelsRef: levelsRef as MutableRefObject<AudioReactiveLevels>,
    manualTakeAssetId,
    manualTakeRequestId
  };
}
