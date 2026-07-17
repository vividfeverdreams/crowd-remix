"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import {
  createAudioSyncBase,
  getAudioSyncChannelName,
  type AudioSyncCueMessage,
  type AudioSyncFrameMessage,
  type AudioSyncStateMessage,
  type AudioSyncTakeMessage
} from "@/lib/audio-sync-channel";
import type { AudioReactiveEffectId } from "@/lib/audio-reactive-effects";
import type { AudioCueEvent, AudioReactiveLevels } from "@/lib/use-audio-reactive-input";

type UseDashboardAudioSyncOptions = {
  sessionId: string;
  connected: boolean;
  intensity: number;
  autoTakeOnCue: boolean;
  effect: AudioReactiveEffectId;
  lastCue: AudioCueEvent | null;
  levelsRef: MutableRefObject<AudioReactiveLevels>;
};

const frameIntervalMs = 50;

export function useDashboardAudioSync({
  sessionId,
  connected,
  intensity,
  autoTakeOnCue,
  effect,
  lastCue,
  levelsRef
}: UseDashboardAudioSyncOptions) {
  const channelRef = useRef<BroadcastChannel | null>(null);
  const sourceIdRef = useRef("");
  const intensityRef = useRef(intensity);
  const autoTakeOnCueRef = useRef(autoTakeOnCue);
  const effectRef = useRef(effect);
  const [supported, setSupported] = useState(true);
  intensityRef.current = intensity;
  autoTakeOnCueRef.current = autoTakeOnCue;
  effectRef.current = effect;

  useEffect(() => {
    if (!("BroadcastChannel" in window)) {
      setSupported(false);
      return;
    }

    const sourceId = createSourceId();
    const channel = new BroadcastChannel(getAudioSyncChannelName(sessionId));
    sourceIdRef.current = sourceId;
    channelRef.current = channel;
    setSupported(true);

    return () => {
      postMessage(channel, {
        ...createAudioSyncBase(sessionId, sourceId),
        type: "state",
        connected: false,
        intensity: intensityRef.current,
        autoTakeOnCue: autoTakeOnCueRef.current,
        effect: effectRef.current
      });
      channel.close();
      channelRef.current = null;
    };
  }, [sessionId]);

  useEffect(() => {
    const channel = channelRef.current;
    const sourceId = sourceIdRef.current;

    if (!channel || !sourceId) {
      return;
    }

    const message: AudioSyncStateMessage = {
      ...createAudioSyncBase(sessionId, sourceId),
      type: "state",
      connected,
      intensity,
      autoTakeOnCue,
      effect
    };
    postMessage(channel, message);
  }, [autoTakeOnCue, connected, effect, intensity, sessionId]);

  useEffect(() => {
    if (!connected) {
      return;
    }

    let animationFrame = 0;
    let lastFrameAt = 0;

    const broadcastFrame = (atMs: number) => {
      const channel = channelRef.current;
      const sourceId = sourceIdRef.current;

      if (channel && sourceId && atMs - lastFrameAt >= frameIntervalMs) {
        lastFrameAt = atMs;
        const message: AudioSyncFrameMessage = {
          ...createAudioSyncBase(sessionId, sourceId),
          type: "frame",
          connected: true,
          intensity,
          autoTakeOnCue,
          effect,
          levels: levelsRef.current
        };
        postMessage(channel, message);
      }

      animationFrame = window.requestAnimationFrame(broadcastFrame);
    };

    animationFrame = window.requestAnimationFrame(broadcastFrame);

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [autoTakeOnCue, connected, effect, intensity, levelsRef, sessionId]);

  useEffect(() => {
    const channel = channelRef.current;
    const sourceId = sourceIdRef.current;

    if (!channel || !sourceId || !lastCue) {
      return;
    }

    const message: AudioSyncCueMessage = {
      ...createAudioSyncBase(sessionId, sourceId),
      type: "cue",
      eventId: `${sourceId}:${lastCue.id}:${lastCue.occurredAt}`,
      cue: lastCue.kind
    };
    postMessage(channel, message);
  }, [lastCue, sessionId]);

  const sendManualTake = useCallback(() => {
    const channel = channelRef.current;
    const sourceId = sourceIdRef.current;

    if (!channel || !sourceId) {
      return false;
    }

    const sentAt = Date.now();
    const message: AudioSyncTakeMessage = {
      ...createAudioSyncBase(sessionId, sourceId),
      type: "take",
      eventId: `${sourceId}:manual:${sentAt}`
    };
    postMessage(channel, message);
    return true;
  }, [sessionId]);

  return {
    sendManualTake,
    supported
  };
}

function createSourceId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `dashboard-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function postMessage(channel: BroadcastChannel, message: AudioSyncStateMessage | AudioSyncFrameMessage | AudioSyncCueMessage | AudioSyncTakeMessage) {
  try {
    channel.postMessage(message);
  } catch {
    // A closing projection window should never interrupt dashboard audio analysis.
  }
}
