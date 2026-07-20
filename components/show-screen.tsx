"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { decideAutomaticCueTransition, getTypewriterChunkSize } from "@/lib/remix-transition";
import type { SessionSnapshot } from "@/lib/snapshot";
import { useAudioReactiveVisualEffect } from "@/lib/use-audio-reactive-visual-effect";
import { useSessionSnapshot } from "@/lib/use-session-snapshot";
import { useShowAudioSync } from "@/lib/use-show-audio-sync";
import { useShowQrOverlay } from "@/lib/use-show-qr-overlay";

type ShowScreenProps = {
  initialSnapshot: NonNullable<SessionSnapshot>;
  isMonitor?: boolean;
};

type QueuedTransition = {
  assetId: string;
  promptText: string;
};

export function ShowScreen({ initialSnapshot, isMonitor = false }: ShowScreenProps) {
  const snapshot = useSessionSnapshot(initialSnapshot);
  const audioSync = useShowAudioSync(initialSnapshot.session.id);
  const qrOverlay = useShowQrOverlay(initialSnapshot.session.id);
  const [fadeNext, setFadeNext] = useState(false);
  const [handledNextAssetId, setHandledNextAssetId] = useState<string | null>(null);
  const [promptReveal, setPromptReveal] = useState<QueuedTransition | null>(null);
  const [submissionUrl, setSubmissionUrl] = useState("");
  const visualTargetRef = useRef<HTMLDivElement>(null);
  const nextVideoRef = useRef<HTMLVideoElement>(null);
  const promptRevealRef = useRef<QueuedTransition | null>(null);
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

  useEffect(() => {
    setSubmissionUrl(new URL(`/r/${session.code}`, window.location.origin).toString());
  }, [session.code]);

  useAudioReactiveVisualEffect({
    active: audioSync.connected,
    effect: audioSync.effect,
    intensity: audioSync.intensity,
    levelsRef: audioSync.levelsRef,
    targetRef: visualTargetRef
  });

  const beginCrossfade = useCallback(
    (transition: QueuedTransition) => {
      setPromptReveal(null);
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

            setHandledNextAssetId(transition.assetId);
          } catch {
            setFadeNext(false);
          } finally {
            transitionInFlightRef.current = false;
            transitionTimerRef.current = null;
          }
        })();
      }, crossfadeDurationMs);
    },
    [crossfadeDurationMs, session.id]
  );

  const finishPromptReveal = useCallback(() => {
    const transition = promptRevealRef.current;

    if (!transition) {
      return;
    }

    promptRevealRef.current = null;
    beginCrossfade(transition);
  }, [beginCrossfade]);

  const takeNext = useCallback(() => {
    const assetId = nextAsset?.id;

    if (!assetId || !nextAssetUrl || assetId === handledNextAssetId || transitionInFlightRef.current) {
      return false;
    }

    const transition = {
      assetId,
      promptText: nextAsset.promptText.trim() || "New remix incoming."
    };

    transitionInFlightRef.current = true;
    promptRevealRef.current = transition;
    void nextVideoRef.current?.play().catch(() => undefined);
    setPromptReveal(transition);
    return true;
  }, [handledNextAssetId, nextAsset, nextAssetUrl]);

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

    const decision = decideAutomaticCueTransition({
      autoTakeOnCue: audioSync.autoTakeOnCue,
      nextAssetReady: Boolean(nextAsset?.id && nextAssetUrl)
    });

    if (decision === "wait-for-remix") {
      return;
    }

    handledCueIdRef.current = cue.id;

    if (decision === "take-remix") {
      takeNext();
    }
  }, [audioSync.autoTakeOnCue, audioSync.connected, audioSync.lastCue, isMonitor, nextAsset?.id, nextAssetUrl, takeNext]);

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

      promptRevealRef.current = null;
    };
  }, []);

  return (
    <main className="relative min-h-screen cursor-none overflow-hidden bg-black">
      <div ref={visualTargetRef} className="absolute inset-0 overflow-hidden">
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
      </div>

      <div className="pointer-events-none absolute inset-0 z-20 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.1),transparent_30%),linear-gradient(180deg,transparent_55%,rgba(0,0,0,0.45)_100%)]" />

      {promptReveal ? (
        <PromptTypewriterOverlay promptText={promptReveal.promptText} onComplete={finishPromptReveal} />
      ) : null}

      {qrOverlay.visible && submissionUrl ? (
        <AudienceQrOverlay submissionUrl={submissionUrl} />
      ) : null}
    </main>
  );
}

function AudienceQrOverlay({ submissionUrl }: { submissionUrl: string }) {
  return (
    <aside className="pointer-events-none absolute right-[clamp(0.75rem,1.5vw,1.5rem)] top-[clamp(0.75rem,1.5vw,1.5rem)] z-50 w-[clamp(5rem,12vw,10rem)]">
      <QRCodeSVG
        value={submissionUrl}
        title="QR code for the audience remix submission page"
        level="H"
        marginSize={4}
        bgColor="#ffffff"
        fgColor="#091018"
        className="h-auto w-full"
      />
    </aside>
  );
}

function PromptTypewriterOverlay({ promptText, onComplete }: { promptText: string; onComplete: () => void }) {
  const [visibleCharacterCount, setVisibleCharacterCount] = useState(0);

  useEffect(() => {
    setVisibleCharacterCount(0);

    let typingTimer: number | null = null;
    let holdTimer: number | null = null;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const scheduleCompletion = (delayMs: number) => {
      holdTimer = window.setTimeout(onComplete, delayMs);
    };

    if (prefersReducedMotion || promptText.length === 0) {
      setVisibleCharacterCount(promptText.length);
      scheduleCompletion(800);
    } else {
      const chunkSize = getTypewriterChunkSize(promptText.length);
      let nextCharacterCount = 0;

      const revealNextChunk = () => {
        nextCharacterCount = Math.min(promptText.length, nextCharacterCount + chunkSize);
        setVisibleCharacterCount(nextCharacterCount);

        if (nextCharacterCount === promptText.length) {
          if (typingTimer !== null) {
            window.clearInterval(typingTimer);
            typingTimer = null;
          }

          scheduleCompletion(950);
        }
      };

      typingTimer = window.setInterval(revealNextChunk, 40);
      revealNextChunk();
    }

    return () => {
      if (typingTimer !== null) {
        window.clearInterval(typingTimer);
      }

      if (holdTimer !== null) {
        window.clearTimeout(holdTimer);
      }
    };
  }, [onComplete, promptText]);

  return (
    <div
      className="pointer-events-none absolute inset-0 z-40 grid place-items-center bg-black/80 px-6 backdrop-blur-sm"
      role="status"
      aria-live="polite"
      aria-label={`Incoming remix prompt: ${promptText}`}
    >
      <div className="w-full max-w-5xl" aria-hidden="true">
        <p className="font-mono text-[10px] uppercase tracking-[0.38em] text-plasma sm:text-xs">Incoming remix</p>
        <p className="mt-5 whitespace-pre-wrap break-words font-mono text-[clamp(1.4rem,4vw,3.6rem)] leading-[1.22] text-white">
          {promptText.slice(0, visibleCharacterCount)}
          <span className="ml-1 inline-block animate-pulse text-plasma">▋</span>
        </p>
      </div>
    </div>
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
