"use client";

import { useEffect, useRef, useState } from "react";
import { AudioSyncControls } from "@/components/audio-sync-controls";
import {
  audioEffectCycleIntervalMs,
  defaultAudioReactiveEffect,
  getNextAudioReactiveEffect,
  type AudioReactiveEffectId
} from "@/lib/audio-reactive-effects";
import { useAudioReactiveInput } from "@/lib/use-audio-reactive-input";
import { useDashboardAudioSync } from "@/lib/use-dashboard-audio-sync";

type DashboardAudioSyncProps = {
  sessionId: string;
  nextReady: boolean;
  relayToken: string;
};

export function DashboardAudioSync({ sessionId, nextReady, relayToken }: DashboardAudioSyncProps) {
  const audio = useAudioReactiveInput();
  const [autoTakeOnCue, setAutoTakeOnCue] = useState(true);
  const [autoCycleEffects, setAutoCycleEffects] = useState(false);
  const [selectedEffect, setSelectedEffect] = useState<AudioReactiveEffectId>(defaultAudioReactiveEffect);
  const [vfxIntensity, setVfxIntensity] = useState(0.85);
  const [transitionFeedback, setTransitionFeedback] = useState<string | null>(null);
  const [takeSignalInFlight, setTakeSignalInFlight] = useState(false);
  const takeSignalTimerRef = useRef<number | null>(null);
  const describedCueIdRef = useRef<string | null>(null);
  const queuedCueIdRef = useRef<string | null>(null);
  const sync = useDashboardAudioSync({
    sessionId,
    relayToken,
    connected: audio.status === "connected",
    intensity: vfxIntensity,
    autoTakeOnCue,
    effect: selectedEffect,
    lastCue: audio.lastCue,
    levelsRef: audio.levelsRef
  });

  useEffect(() => {
    if (!autoCycleEffects || audio.status !== "connected") {
      return;
    }

    const cycleTimer = window.setInterval(() => {
      setSelectedEffect((currentEffect) => getNextAudioReactiveEffect(currentEffect));
    }, audioEffectCycleIntervalMs);

    return () => {
      window.clearInterval(cycleTimer);
    };
  }, [audio.status, autoCycleEffects]);

  useEffect(() => {
    if (!audio.lastCue) {
      return;
    }

    const cueId = `${audio.lastCue.id}:${audio.lastCue.occurredAt}`;

    if (describedCueIdRef.current === cueId) {
      return;
    }

    describedCueIdRef.current = cueId;

    const cueLabel = audio.lastCue.kind === "build" ? "Build" : "Section change";

    if (!autoTakeOnCue) {
      queuedCueIdRef.current = null;
      setTransitionFeedback(`${cueLabel} detected. Automatic take is disabled.`);
    } else if (!nextReady) {
      queuedCueIdRef.current = cueId;
      setTransitionFeedback(`${cueLabel} detected. The take is queued until the next remix is ready.`);
    } else {
      queuedCueIdRef.current = null;
      setTransitionFeedback(`${cueLabel} detected. The take signal was sent to the show output.`);
    }
  }, [audio.lastCue, autoTakeOnCue, nextReady]);

  useEffect(() => {
    if (!autoTakeOnCue) {
      queuedCueIdRef.current = null;
      return;
    }

    if (!nextReady || !queuedCueIdRef.current) {
      return;
    }

    queuedCueIdRef.current = null;
    setTransitionFeedback("The remix is ready. Taking it now on the queued musical cue.");
  }, [autoTakeOnCue, nextReady]);

  useEffect(() => {
    return () => {
      if (takeSignalTimerRef.current !== null) {
        window.clearTimeout(takeSignalTimerRef.current);
      }
    };
  }, []);

  function sendManualTake() {
    if (!sync.sendManualTake()) {
      setTransitionFeedback("The show output channel is unavailable. Keep this dashboard open and launch the show from Pop Out Show.");
      return;
    }

    setTakeSignalInFlight(true);
    setTransitionFeedback("Manual take sent to the show output.");

    if (takeSignalTimerRef.current !== null) {
      window.clearTimeout(takeSignalTimerRef.current);
    }

    takeSignalTimerRef.current = window.setTimeout(() => {
      setTakeSignalInFlight(false);
      takeSignalTimerRef.current = null;
    }, 2400);
  }

  const channelError = sync.supported
    ? null
    : "The live VFX relay cannot reach the show output right now. Keep this dashboard online and reconnect the input.";

  return (
    <AudioSyncControls
      activeDeviceId={audio.activeDeviceId}
      autoCycleEffects={autoCycleEffects}
      autoTakeOnCue={autoTakeOnCue}
      devices={audio.devices}
      error={audio.error ?? channelError}
      intensity={vfxIntensity}
      lastCue={audio.lastCue}
      levels={audio.meterLevels}
      nextReady={nextReady}
      selectedDeviceId={audio.selectedDeviceId}
      selectedEffect={selectedEffect}
      status={audio.status}
      transitionFeedback={transitionFeedback}
      transitionInFlight={takeSignalInFlight}
      onAutoCycleEffectsChange={setAutoCycleEffects}
      onAutoTakeChange={setAutoTakeOnCue}
      onConnect={() => void audio.connect()}
      onDisconnect={audio.disconnect}
      onIntensityChange={setVfxIntensity}
      onSelectedDeviceChange={audio.setSelectedDeviceId}
      onSelectedEffectChange={setSelectedEffect}
      onTakeNext={sendManualTake}
    />
  );
}
