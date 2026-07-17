"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AudioReactiveOverlay } from "@/components/audio-reactive-overlay";
import type { SessionSnapshot } from "@/lib/snapshot";
import { useSessionSnapshot } from "@/lib/use-session-snapshot";
import { useShowAudioSync } from "@/lib/use-show-audio-sync";

type ShowScreenProps = {
  initialSnapshot: NonNullable<SessionSnapshot>;
  isMonitor?: boolean;
};

export function ShowScreen({ initialSnapshot, isMonitor = false }: ShowScreenProps) {
  const snapshot = useSessionSnapshot(initialSnapshot);
  const audioSync = useShowAudioSync(initialSnapshot.session.id);
  const [fadeNext, setFadeNext] = useState(false);
  const [handledNextAssetId, setHandledNextAssetId] = useState<string | null>(null);
  const nextVideoRef = useRef<HTMLVideoElement>(null);
  const transitionTimerRef = useRef<number | null>(null);
  const transitionInFlightRef = useRef(false);
  const handledCueIdRef = useRef<string | null>(null);
  const handledManualTakeIdRef = useRef<string | null>(null);

  const session = snapshot.session;
  const playback = session.playbackState;
  const currentAsset = playback?.currentAsset ?? null;
  const nextAsset = playback?.nextAsset ?? null;
  const currentAssetUrl = resolvePlaybackUrl(currentAsset?.publicUrl ?? null);
  const nextAssetUrl = resolvePlaybackUrl(nextAsset?.publicUrl ?? null);
  const shouldRenderNext = Boolean(nextAssetUrl);
  const crossfadeDurationMs = Math.max(400, Math.round((playback?.crossfadeSeconds ?? 2) * 1000));

  const takeNext = useCallback(
    () => {
      const assetId = nextAsset?.id;

      if (!assetId || !nextAssetUrl || assetId === handledNextAssetId || transitionInFlightRef.current) {
        return false;
      }

      transitionInFlightRef.current = true;
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
          } catch {
            setFadeNext(false);
          } finally {
            transitionInFlightRef.current = false;
            transitionTimerRef.current = null;
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
  }, [currentAsset?.id, handledNextAssetId]);

  useEffect(() => {
    if (isMonitor || !nextAsset?.id || nextAsset.id === handledNextAssetId || audioSync.connected) {
      return;
    }

    const automaticTake = window.setTimeout(() => {
      takeNext();
    }, 600);

    return () => {
      window.clearTimeout(automaticTake);
    };
  }, [audioSync.connected, handledNextAssetId, isMonitor, nextAsset?.id, takeNext]);

  useEffect(() => {
    const cue = audioSync.lastCue;

    if (isMonitor || !audioSync.connected || !cue || cue.id === handledCueIdRef.current) {
      return;
    }

    handledCueIdRef.current = cue.id;

    if (!audioSync.autoTakeOnCue || !nextAsset?.id) {
      return;
    }

    takeNext();
  }, [audioSync.autoTakeOnCue, audioSync.connected, audioSync.lastCue, isMonitor, nextAsset?.id, takeNext]);

  useEffect(() => {
    const requestId = audioSync.manualTakeRequestId;

    if (isMonitor || !requestId || requestId === handledManualTakeIdRef.current) {
      return;
    }

    handledManualTakeIdRef.current = requestId;
    takeNext();
  }, [audioSync.manualTakeRequestId, isMonitor, takeNext]);

  useEffect(() => {
    return () => {
      if (transitionTimerRef.current !== null) {
        window.clearTimeout(transitionTimerRef.current);
      }
    };
  }, []);

  return (
    <main className="relative min-h-screen cursor-none overflow-hidden bg-black">
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

      <AudioReactiveOverlay active={audioSync.connected} intensity={audioSync.intensity} levelsRef={audioSync.levelsRef} />

      <div className="pointer-events-none absolute inset-0 z-20 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.1),transparent_30%),linear-gradient(180deg,transparent_55%,rgba(0,0,0,0.45)_100%)]" />
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
