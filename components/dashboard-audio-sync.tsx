"use client";

import { useEffect, useRef, useState } from "react";
import { AudioSyncControls } from "@/components/audio-sync-controls";
import { useAudioReactiveInput } from "@/lib/use-audio-reactive-input";
import { useDashboardAudioSync } from "@/lib/use-dashboard-audio-sync";

type DashboardAudioSyncProps = {
  sessionId: string;
  nextReady: boolean;
};

export function DashboardAudioSync({ sessionId, nextReady }: DashboardAudioSyncProps) {
  const audio = useAudioReactiveInput();
  const [autoTakeOnCue, setAutoTakeOnCue] = useState(true);
  const [vfxIntensity, setVfxIntensity] = useState(0.85);
  const [transitionFeedback, setTransitionFeedback] = useState<string | null>(null);
  const [takeSignalInFlight, setTakeSignalInFlight] = useState(false);
  const takeSignalTimerRef = useRef<number | null>(null);
  const describedCueIdRef = useRef<string | null>(null);
  const sync = useDashboardAudioSync({
    sessionId,
    connected: audio.status === "connected",
    intensity: vfxIntensity,
    autoTakeOnCue,
    lastCue: audio.lastCue,
    levelsRef: audio.levelsRef
  });

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
      setTransitionFeedback(`${cueLabel} detected. Automatic take is disabled.`);
    } else if (!nextReady) {
      setTransitionFeedback(`${cueLabel} detected, but the next remix is not ready yet.`);
    } else {
      setTransitionFeedback(`${cueLabel} detected. The take signal was sent to the show output.`);
    }
  }, [audio.lastCue, autoTakeOnCue, nextReady]);

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
    : "This browser cannot synchronize the dashboard with the show window. Use a current Chrome, Edge, or Safari build.";

  return (
    <AudioSyncControls
      activeDeviceId={audio.activeDeviceId}
      autoTakeOnCue={autoTakeOnCue}
      devices={audio.devices}
      error={audio.error ?? channelError}
      intensity={vfxIntensity}
      lastCue={audio.lastCue}
      levels={audio.meterLevels}
      nextReady={nextReady}
      selectedDeviceId={audio.selectedDeviceId}
      status={audio.status}
      transitionFeedback={transitionFeedback}
      transitionInFlight={takeSignalInFlight}
      onAutoTakeChange={setAutoTakeOnCue}
      onConnect={() => void audio.connect()}
      onDisconnect={audio.disconnect}
      onIntensityChange={setVfxIntensity}
      onSelectedDeviceChange={audio.setSelectedDeviceId}
      onTakeNext={sendManualTake}
    />
  );
}
