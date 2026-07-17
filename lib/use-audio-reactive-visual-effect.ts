"use client";

import { useEffect, type MutableRefObject, type RefObject } from "react";
import type { AudioReactiveEffectId } from "@/lib/audio-reactive-effects";
import type { AudioReactiveLevels } from "@/lib/use-audio-reactive-input";

type AudioReactiveVisualStyle = {
  filter: string;
  transform: string;
};

type UseAudioReactiveVisualEffectOptions = {
  active: boolean;
  effect: AudioReactiveEffectId;
  intensity: number;
  levelsRef: MutableRefObject<AudioReactiveLevels>;
  targetRef: RefObject<HTMLElement | null>;
};

export function useAudioReactiveVisualEffect({
  active,
  effect,
  intensity,
  levelsRef,
  targetRef
}: UseAudioReactiveVisualEffectOptions) {
  useEffect(() => {
    const target = targetRef.current;

    if (!target || !active) {
      if (target) resetVisualStyle(target);
      return;
    }

    let animationFrame = 0;
    target.style.transformOrigin = "center center";
    target.style.willChange = "filter, transform";
    target.style.backfaceVisibility = "hidden";

    const updateVisual = (atMs: number) => {
      const style = getAudioReactiveVisualStyle(effect, levelsRef.current, intensity, atMs / 1000);
      target.style.filter = style.filter;
      target.style.transform = style.transform;
      animationFrame = window.requestAnimationFrame(updateVisual);
    };

    animationFrame = window.requestAnimationFrame(updateVisual);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resetVisualStyle(target);
    };
  }, [active, effect, intensity, levelsRef, targetRef]);
}

export function getAudioReactiveVisualStyle(
  effect: AudioReactiveEffectId,
  levels: AudioReactiveLevels,
  intensity: number,
  phase: number
): AudioReactiveVisualStyle {
  const strength = Math.max(0, intensity);

  switch (effect) {
    case "bass-zoom": {
      const scale = 1.02 + (levels.bass * 0.1 + levels.beatPulse * 0.035) * strength;
      return {
        filter: `saturate(${1 + levels.energy * 0.3 * strength}) contrast(${1 + levels.bass * 0.12 * strength})`,
        transform: `scale(${scale})`
      };
    }
    case "hue-shift": {
      const hue = (phase * 18 + levels.mid * 150 + levels.high * 90) * strength;
      return {
        filter: `hue-rotate(${hue}deg) saturate(${1 + levels.energy * 0.85 * strength})`,
        transform: `scale(${1.02 + levels.bass * 0.025 * strength})`
      };
    }
    case "contrast-pump":
      return {
        filter: `contrast(${1 + (levels.energy * 0.9 + levels.beatPulse * 0.35) * strength}) saturate(${1 + levels.mid * 0.65 * strength}) brightness(${1 + levels.beatPulse * 0.1 * strength})`,
        transform: "scale(1.02)"
      };
    case "focus-pulse": {
      const blur = (levels.mid * 5.5 + levels.high * 2) * (1 - levels.beatPulse * 0.75) * strength;
      return {
        filter: `blur(${Math.max(0, blur)}px) saturate(${1 + levels.energy * 0.4 * strength})`,
        transform: `scale(${1.035 + blur * 0.0025})`
      };
    }
    case "beat-invert":
      return {
        filter: `invert(${clamp01(levels.beatPulse * 0.95 * strength)}) hue-rotate(${levels.beatPulse * 150 * strength}deg) contrast(${1 + levels.bass * 0.25 * strength})`,
        transform: `scale(${1.02 + levels.beatPulse * 0.02 * strength})`
      };
    case "glitch-jitter": {
      const x = Math.sin(phase * 47) * levels.high * 15 * strength;
      const y = Math.cos(phase * 31) * (levels.high + levels.beatPulse) * 7 * strength;
      const skew = Math.sin(phase * 23) * levels.beatPulse * 2.2 * strength;
      return {
        filter: `contrast(${1 + levels.high * 0.55 * strength}) saturate(${1 + levels.mid * 0.65 * strength}) hue-rotate(${Math.sin(phase * 9) * levels.high * 16 * strength}deg)`,
        transform: `translate3d(${x}px, ${y}px, 0) skewX(${skew}deg) scale(${1.045 + levels.beatPulse * 0.018 * strength})`
      };
    }
    case "elastic-stretch": {
      const scaleX = 1.025 + levels.mid * 0.085 * strength;
      const scaleY = 1.025 + levels.bass * 0.1 * strength;
      return {
        filter: `saturate(${1 + levels.high * 0.35 * strength})`,
        transform: `scaleX(${scaleX}) scaleY(${scaleY})`
      };
    }
    case "monochrome-pulse": {
      const grayscale = clamp01(1 - levels.beatPulse * 1.15 * strength);
      return {
        filter: `grayscale(${grayscale}) contrast(${1 + levels.energy * 0.45 * strength}) brightness(${0.92 + levels.beatPulse * 0.18 * strength})`,
        transform: `scale(${1.02 + levels.bass * 0.025 * strength})`
      };
    }
    case "heat-shift":
      return {
        filter: `sepia(${clamp01((0.25 + levels.bass * 0.65) * strength)}) hue-rotate(${-18 + levels.mid * 34 * strength}deg) saturate(${1 + levels.bass * 1.15 * strength}) brightness(${1 + levels.energy * 0.12 * strength})`,
        transform: `scale(${1.02 + levels.bass * 0.035 * strength})`
      };
    case "exposure-strobe":
      return {
        filter: `brightness(${1 + levels.beatPulse * 1.05 * strength}) contrast(${1 + levels.beatPulse * 0.28 * strength}) saturate(${1 + levels.high * 0.35 * strength})`,
        transform: `scale(${1.02 + levels.beatPulse * 0.025 * strength})`
      };
  }
}

function resetVisualStyle(target: HTMLElement) {
  target.style.removeProperty("backface-visibility");
  target.style.removeProperty("filter");
  target.style.removeProperty("transform");
  target.style.removeProperty("transform-origin");
  target.style.removeProperty("will-change");
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}
