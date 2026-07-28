"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import {
  createAudioSyncBase,
  getAudioSyncChannelName,
  type AudioSyncCueMessage,
  type AudioSyncFrameMessage,
  type AudioSyncMessage,
  type AudioSyncStateMessage,
  type AudioSyncTakeMessage
} from "@/lib/audio-sync-channel";
import type { AudioReactiveEffectId } from "@/lib/audio-reactive-effects";
import type { AudioCueEvent, AudioReactiveLevels } from "@/lib/use-audio-reactive-input";

type UseDashboardAudioSyncOptions = {
  sessionId: string;
  relayToken: string;
  connected: boolean;
  intensity: number;
  autoTakeOnCue: boolean;
  effect: AudioReactiveEffectId;
  lastCue: AudioCueEvent | null;
  levelsRef: MutableRefObject<AudioReactiveLevels>;
};

const relayFrameIntervalMs = 100;
const relayFailureThreshold = 3;
const relayRetryBackoffMs = 5000;

export function useDashboardAudioSync({
  sessionId,
  relayToken,
  connected,
  intensity,
  autoTakeOnCue,
  effect,
  lastCue,
  levelsRef
}: UseDashboardAudioSyncOptions) {
  const channelRef = useRef<BroadcastChannel | null>(null);
  const sourceIdRef = useRef("");
  const relayTokenRef = useRef(relayToken);
  const relayTokenRefreshRef = useRef<Promise<string | null> | null>(null);
  const relayFrameInFlightRef = useRef(false);
  const relayFailureCountRef = useRef(0);
  const relayRetryAfterRef = useRef(0);
  const intensityRef = useRef(intensity);
  const autoTakeOnCueRef = useRef(autoTakeOnCue);
  const effectRef = useRef(effect);
  const [supported, setSupported] = useState(true);
  intensityRef.current = intensity;
  autoTakeOnCueRef.current = autoTakeOnCue;
  effectRef.current = effect;

  useEffect(() => {
    relayTokenRef.current = relayToken;
  }, [relayToken]);

  const refreshRelayToken = useCallback(() => {
    if (relayTokenRefreshRef.current) {
      return relayTokenRefreshRef.current;
    }

    const refreshRequest = fetch(`/api/sessions/${sessionId}/audio-sync`, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin"
    })
      .then(async (response) => {
        if (!response.ok) {
          return null;
        }

        const payload = (await response.json().catch(() => null)) as {
          relayToken?: unknown;
        } | null;
        const nextToken = typeof payload?.relayToken === "string" ? payload.relayToken : null;

        if (nextToken) {
          relayTokenRef.current = nextToken;
        }

        return nextToken;
      })
      .catch(() => null)
      .finally(() => {
        relayTokenRefreshRef.current = null;
      });

    relayTokenRefreshRef.current = refreshRequest;
    return refreshRequest;
  }, [sessionId]);

  const relayMessage = useCallback(
    async (message: AudioSyncMessage, replaceable: boolean) => {
      if (replaceable && Date.now() < relayRetryAfterRef.current) {
        return;
      }

      if (replaceable && relayFrameInFlightRef.current) {
        return;
      }

      if (replaceable) {
        relayFrameInFlightRef.current = true;
      }

      try {
        let response = await postRelayMessage(sessionId, relayTokenRef.current, message);

        if (response.status === 401) {
          const nextToken = await refreshRelayToken();

          if (nextToken) {
            response = await postRelayMessage(sessionId, nextToken, message);
          }
        }

        if (!response.ok) {
          throw new Error(`Audio relay rejected the update with ${response.status}.`);
        }

        relayFailureCountRef.current = 0;
        relayRetryAfterRef.current = 0;
        setSupported(true);
      } catch {
        relayFailureCountRef.current += 1;

        if (relayFailureCountRef.current >= relayFailureThreshold) {
          relayRetryAfterRef.current = Date.now() + relayRetryBackoffMs;
          setSupported(false);
        }
      } finally {
        if (replaceable) {
          relayFrameInFlightRef.current = false;
        }
      }
    },
    [refreshRelayToken, sessionId]
  );

  const sendMessage = useCallback(
    (message: AudioSyncMessage, replaceable = false) => {
      const channel = channelRef.current;

      if (channel) {
        postLocalMessage(channel, message);
      }

      void relayMessage(message, replaceable);
    },
    [relayMessage]
  );

  useEffect(() => {
    const sourceId = createSourceId();
    sourceIdRef.current = sourceId;

    if ("BroadcastChannel" in window) {
      channelRef.current = new BroadcastChannel(getAudioSyncChannelName(sessionId));
    }

    setSupported(true);

    return () => {
      const message: AudioSyncStateMessage = {
        ...createAudioSyncBase(sessionId, sourceId),
        type: "state",
        connected: false,
        intensity: intensityRef.current,
        autoTakeOnCue: autoTakeOnCueRef.current,
        effect: effectRef.current
      };

      if (channelRef.current) {
        postLocalMessage(channelRef.current, message);
        channelRef.current.close();
        channelRef.current = null;
      }

      void postRelayMessage(sessionId, relayTokenRef.current, message, true).catch(() => undefined);
      sourceIdRef.current = "";
    };
  }, [sessionId]);

  useEffect(() => {
    const sourceId = sourceIdRef.current;

    if (!sourceId) {
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
    sendMessage(message);
  }, [autoTakeOnCue, connected, effect, intensity, sendMessage, sessionId]);

  useEffect(() => {
    if (!connected) {
      return;
    }

    let animationFrame = 0;
    let lastFrameAt = 0;

    const broadcastFrame = (atMs: number) => {
      const sourceId = sourceIdRef.current;

      if (sourceId && atMs - lastFrameAt >= relayFrameIntervalMs) {
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
        sendMessage(message, true);
      }

      animationFrame = window.requestAnimationFrame(broadcastFrame);
    };

    animationFrame = window.requestAnimationFrame(broadcastFrame);

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [autoTakeOnCue, connected, effect, intensity, levelsRef, sendMessage, sessionId]);

  useEffect(() => {
    const sourceId = sourceIdRef.current;

    if (!sourceId || !lastCue) {
      return;
    }

    const message: AudioSyncCueMessage = {
      ...createAudioSyncBase(sessionId, sourceId),
      type: "cue",
      eventId: `${sourceId}:${lastCue.id}:${lastCue.occurredAt}`,
      cue: lastCue.kind
    };
    sendMessage(message);
  }, [lastCue, sendMessage, sessionId]);

  const sendManualTake = useCallback(() => {
    const sourceId = sourceIdRef.current;

    if (!sourceId || !supported) {
      return false;
    }

    const sentAt = Date.now();
    const message: AudioSyncTakeMessage = {
      ...createAudioSyncBase(sessionId, sourceId),
      type: "take",
      eventId: `${sourceId}:manual:${sentAt}`
    };
    sendMessage(message);
    return true;
  }, [sendMessage, sessionId, supported]);

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

function postLocalMessage(channel: BroadcastChannel, message: AudioSyncMessage) {
  try {
    channel.postMessage(message);
  } catch {
    // A closing projection window should never interrupt dashboard audio analysis.
  }
}

function postRelayMessage(
  sessionId: string,
  relayToken: string,
  message: AudioSyncMessage,
  keepalive = false
) {
  return fetch(`/api/sessions/${sessionId}/audio-sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${relayToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(message),
    cache: "no-store",
    keepalive
  });
}
