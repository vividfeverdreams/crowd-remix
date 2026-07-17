"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { getAudioSyncChannelName, isAudioSyncMessage } from "@/lib/audio-sync-channel";
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

export function useShowAudioSync(sessionId: string) {
  const levelsRef = useRef<AudioReactiveLevels>({ ...silentLevels });
  const lastMessageAtRef = useRef(0);
  const [connected, setConnected] = useState(false);
  const [intensity, setIntensity] = useState(0.85);
  const [autoTakeOnCue, setAutoTakeOnCue] = useState(true);
  const [effect, setEffect] = useState<AudioReactiveEffectId>(defaultAudioReactiveEffect);
  const [lastCue, setLastCue] = useState<RemoteAudioCue | null>(null);
  const [manualTakeRequestId, setManualTakeRequestId] = useState<string | null>(null);

  useEffect(() => {
    if (!("BroadcastChannel" in window)) {
      return;
    }

    const channel = new BroadcastChannel(getAudioSyncChannelName(sessionId));

    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (!isAudioSyncMessage(event.data) || event.data.sessionId !== sessionId) {
        return;
      }

      const message = event.data;
      lastMessageAtRef.current = Date.now();

      if (message.type === "frame") {
        levelsRef.current = message.levels;
        setConnected(true);
        setIntensity(message.intensity);
        setAutoTakeOnCue(message.autoTakeOnCue);
        setEffect(message.effect);
        return;
      }

      if (message.type === "state") {
        setConnected(message.connected);
        setIntensity(message.intensity);
        setAutoTakeOnCue(message.autoTakeOnCue);
        setEffect(message.effect);

        if (!message.connected) {
          levelsRef.current = { ...silentLevels };
        }
        return;
      }

      if (message.type === "cue") {
        setLastCue({
          id: message.eventId,
          kind: message.cue,
          occurredAt: message.sentAt
        });
        return;
      }

      setManualTakeRequestId(message.eventId);
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
      channel.close();
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
    manualTakeRequestId
  };
}
