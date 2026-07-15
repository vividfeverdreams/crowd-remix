"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AudioReactiveOverlay } from "@/components/audio-reactive-overlay";
import { AudioSyncControls } from "@/components/audio-sync-controls";
import type { SessionSnapshot } from "@/lib/snapshot";
import { useAudioReactiveInput } from "@/lib/use-audio-reactive-input";
import { useSessionSnapshot } from "@/lib/use-session-snapshot";

type ShowScreenProps = {
  initialSnapshot: NonNullable<SessionSnapshot>;
  isMonitor?: boolean;
  openAiConfigured: boolean;
};

export function ShowScreen({ initialSnapshot, isMonitor = false, openAiConfigured }: ShowScreenProps) {
  const snapshot = useSessionSnapshot(initialSnapshot);
  const audio = useAudioReactiveInput(!isMonitor);
  const [fadeNext, setFadeNext] = useState(false);
  const [handledNextAssetId, setHandledNextAssetId] = useState<string | null>(null);
  const [autoTakeOnCue, setAutoTakeOnCue] = useState(true);
  const [vfxIntensity, setVfxIntensity] = useState(0.85);
  const [transitionInFlight, setTransitionInFlight] = useState(false);
  const [transitionFeedback, setTransitionFeedback] = useState<string | null>(null);
  const nextVideoRef = useRef<HTMLVideoElement>(null);
  const transitionTimerRef = useRef<number | null>(null);
  const transitionInFlightRef = useRef(false);
  const handledCueIdRef = useRef<number | null>(null);

  const session = snapshot.session;
  const playback = session.playbackState;
  const currentAsset = playback?.currentAsset ?? null;
  const nextAsset = playback?.nextAsset ?? null;
  const currentAssetUrl = resolvePlaybackUrl(currentAsset?.publicUrl ?? null);
  const nextAssetUrl = resolvePlaybackUrl(nextAsset?.publicUrl ?? null);
  const shouldRenderNext = Boolean(nextAssetUrl);
  const crossfadeDurationMs = Math.max(400, Math.round((playback?.crossfadeSeconds ?? 2) * 1000));

  const takeNext = useCallback(
    (reason: string) => {
      const assetId = nextAsset?.id;

      if (!assetId || !nextAssetUrl || assetId === handledNextAssetId || transitionInFlightRef.current) {
        return false;
      }

      transitionInFlightRef.current = true;
      setTransitionInFlight(true);
      setTransitionFeedback(`Crossfading on ${reason}.`);
      void nextVideoRef.current?.play().catch(() => undefined);
      setFadeNext(true);

      if (transitionTimerRef.current !== null) {
        window.clearTimeout(transitionTimerRef.current);
      }

      transitionTimerRef.current = window.setTimeout(() => {
        void (async () => {
          try {
            const response = await fetch(`/api/sessions/${session.id}/transition`, {
              method: "POST"
            });

            if (!response.ok) {
              throw new Error("The transition endpoint rejected the cutover.");
            }

            setHandledNextAssetId(assetId);
            setTransitionFeedback("Remix promoted live. Holding the new layer while playback state catches up.");
          } catch {
            setFadeNext(false);
            setTransitionFeedback("The visual faded in, but the server could not promote it. Use Take next remix now to retry.");
          } finally {
            transitionInFlightRef.current = false;
            transitionTimerRef.current = null;
            setTransitionInFlight(false);
          }
        })();
      }, crossfadeDurationMs);

      return true;
    },
    [crossfadeDurationMs, handledNextAssetId, nextAsset?.id, nextAssetUrl, session.id]
  );

  useEffect(() => {
    if (!handledNextAssetId || currentAsset?.id !== handledNextAssetId) {
      return;
    }

    setFadeNext(false);
    setHandledNextAssetId(null);
    setTransitionFeedback("New remix is live and audio sync is re-armed.");
  }, [currentAsset?.id, handledNextAssetId]);

  useEffect(() => {
    if (isMonitor || !nextAsset?.id || nextAsset.id === handledNextAssetId || audio.status === "connected") {
      return;
    }

    const automaticTake = window.setTimeout(() => {
      takeNext("ready remix");
    }, 120);

    return () => {
      window.clearTimeout(automaticTake);
    };
  }, [audio.status, handledNextAssetId, isMonitor, nextAsset?.id, takeNext]);

  useEffect(() => {
    const cue = audio.lastCue;

    if (audio.status !== "connected" || !cue || cue.id === handledCueIdRef.current) {
      return;
    }

    handledCueIdRef.current = cue.id;
    const cueLabel = cue.kind === "build" ? "detected build" : "detected section change";

    if (!autoTakeOnCue) {
      setTransitionFeedback(`${cueLabel} detected. Auto take is disabled.`);
      return;
    }

    if (!nextAsset?.id) {
      setTransitionFeedback(`${cueLabel} detected, but the next remix is not ready yet.`);
      return;
    }

    takeNext(cueLabel);
  }, [audio.lastCue, audio.status, autoTakeOnCue, nextAsset?.id, takeNext]);

  useEffect(() => {
    return () => {
      if (transitionTimerRef.current !== null) {
        window.clearTimeout(transitionTimerRef.current);
      }
    };
  }, []);

  const debugLabel = !currentAsset
    ? session.status === "draft"
      ? "Start the session from the dashboard to seed the first loop"
      : "Holding for first completed loop"
    : nextAsset
      ? isMonitor
        ? "Ready remix waiting for the show output"
        : audio.status === "connected"
          ? "Ready remix waiting for musical cue"
          : "Crossfade armed"
      : "Live loop stable";

  return (
    <main className="relative min-h-screen overflow-hidden bg-black">
      {currentAssetUrl ? (
        <video
          key={currentAsset?.id}
          className="absolute inset-0 h-full w-full object-cover"
          src={currentAssetUrl}
          autoPlay
          loop
          muted
          playsInline
        />
      ) : (
        <div className="absolute inset-0 subtle-grid bg-aurora" />
      )}

      {shouldRenderNext && nextAssetUrl ? (
        <video
          key={nextAsset?.id}
          ref={nextVideoRef}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-[2200ms] ${
            fadeNext ? "opacity-100" : "opacity-0"
          }`}
          style={{
            transitionDuration: `${crossfadeDurationMs}ms`
          }}
          src={nextAssetUrl}
          autoPlay
          loop
          muted
          playsInline
        />
      ) : null}

      <AudioReactiveOverlay active={!isMonitor && audio.status === "connected"} intensity={vfxIntensity} levelsRef={audio.levelsRef} />

      <div className="pointer-events-none absolute inset-0 z-20 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.1),transparent_30%),linear-gradient(180deg,transparent_55%,rgba(0,0,0,0.45)_100%)]" />

      <div className="absolute bottom-0 left-0 right-0 z-30 flex items-end justify-between gap-6 p-6">
        <div className="max-w-3xl rounded-4xl border border-white/10 bg-black/25 px-5 py-4 backdrop-blur">
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-plasma">{session.artistName}</p>
          <p className="mt-2 text-2xl font-semibold text-white">{session.trackName}</p>
          <p className="mt-3 text-sm text-white/70">{debugLabel}</p>
          {!openAiConfigured ? <p className="mt-2 text-xs uppercase tracking-[0.22em] text-amber-200/90">Demo loop fallback active</p> : null}
        </div>

        <div className="rounded-4xl border border-white/10 bg-black/25 px-5 py-4 text-right backdrop-blur">
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-white/45">Queue</p>
          <p className="mt-2 text-sm text-white/70">
            {nextAsset ? "Next remix loaded" : snapshot.queueHealth.waitingOnRender ? "Rendering next remix" : "Loop secured"}
          </p>
        </div>
      </div>

      {!isMonitor ? (
        <AudioSyncControls
          activeDeviceId={audio.activeDeviceId}
          autoTakeOnCue={autoTakeOnCue}
          devices={audio.devices}
          error={audio.error}
          intensity={vfxIntensity}
          lastCue={audio.lastCue}
          levels={audio.meterLevels}
          nextReady={Boolean(nextAsset?.id && nextAssetUrl)}
          selectedDeviceId={audio.selectedDeviceId}
          status={audio.status}
          transitionFeedback={transitionFeedback}
          transitionInFlight={transitionInFlight}
          onAutoTakeChange={setAutoTakeOnCue}
          onConnect={() => void audio.connect()}
          onDisconnect={audio.disconnect}
          onIntensityChange={setVfxIntensity}
          onSelectedDeviceChange={audio.setSelectedDeviceId}
          onTakeNext={() => {
            takeNext("manual take");
          }}
        />
      ) : null}
    </main>
  );
}

function resolvePlaybackUrl(url: string | null) {
  if (!url) {
    return null;
  }

  if (typeof window === "undefined") {
    return url;
  }

  try {
    const resolved = new URL(url, window.location.origin);

    if (
      resolved.hostname === "localhost" &&
      resolved.pathname.startsWith("/api/assets/")
    ) {
      return `${window.location.origin}${resolved.pathname}`;
    }

    return resolved.toString();
  } catch {
    return url;
  }
}
