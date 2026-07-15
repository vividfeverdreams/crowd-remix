"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import type { AudioReactiveLevels } from "@/lib/use-audio-reactive-input";

type AudioReactiveOverlayProps = {
  active: boolean;
  intensity: number;
  levelsRef: MutableRefObject<AudioReactiveLevels>;
};

export function AudioReactiveOverlay({ active, intensity, levelsRef }: AudioReactiveOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    if (!canvas || !context || !active) {
      context?.clearRect(0, 0, canvas?.width ?? 0, canvas?.height ?? 0);
      return;
    }

    let width = 0;
    let height = 0;
    let animationFrame = 0;

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      width = bounds.width;
      height = bounds.height;
      canvas.width = Math.max(1, Math.round(width * pixelRatio));
      canvas.height = Math.max(1, Math.round(height * pixelRatio));
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const draw = (atMs: number) => {
      const levels = levelsRef.current;
      const strength = Math.max(0, intensity);
      const shortestSide = Math.min(width, height);
      const phase = atMs / 1000;
      const centerX = width * (0.5 + Math.sin(phase * 0.23) * 0.08);
      const centerY = height * (0.48 + Math.cos(phase * 0.19) * 0.06);
      const hue = 155 + levels.mid * 65 + levels.high * 45;

      context.clearRect(0, 0, width, height);
      context.save();
      context.globalCompositeOperation = "screen";

      const glowRadius = shortestSide * (0.28 + levels.bass * 0.42 + levels.beatPulse * 0.08);
      const glow = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, glowRadius);
      glow.addColorStop(0, `hsla(${hue}, 94%, 62%, ${(0.05 + levels.energy * 0.2 + levels.beatPulse * 0.08) * strength})`);
      glow.addColorStop(0.55, `hsla(${hue + 55}, 90%, 56%, ${(0.025 + levels.mid * 0.11) * strength})`);
      glow.addColorStop(1, "rgba(0,0,0,0)");
      context.fillStyle = glow;
      context.fillRect(0, 0, width, height);

      for (let ring = 0; ring < 3; ring += 1) {
        const radius = shortestSide * (0.16 + ring * 0.1 + levels.bass * 0.08) + levels.beatPulse * 18;
        context.beginPath();
        context.arc(centerX, centerY, radius, 0, Math.PI * 2);
        context.strokeStyle = `hsla(${hue + ring * 34}, 95%, 70%, ${(0.035 + levels.bass * 0.16) * strength})`;
        context.lineWidth = 1 + levels.energy * 4 + levels.beatPulse * 3;
        context.setLineDash([10 + levels.mid * 28, 18 + ring * 8]);
        context.lineDashOffset = -phase * (18 + ring * 8);
        context.stroke();
      }

      context.setLineDash([]);
      context.beginPath();
      const amplitude = height * (0.018 + levels.mid * 0.09) * strength;
      const segments = 56;

      for (let index = 0; index <= segments; index += 1) {
        const progress = index / segments;
        const x = progress * width;
        const envelope = Math.sin(progress * Math.PI);
        const y =
          height * 0.52 +
          Math.sin(progress * Math.PI * (6 + levels.high * 10) + phase * 4) * amplitude * envelope;

        if (index === 0) {
          context.moveTo(x, y);
        } else {
          context.lineTo(x, y);
        }
      }

      context.strokeStyle = `hsla(${hue + 95}, 100%, 76%, ${(0.04 + levels.mid * 0.18) * strength})`;
      context.lineWidth = 1.5 + levels.energy * 2;
      context.stroke();

      const beamCount = 6;
      for (let beam = 0; beam < beamCount; beam += 1) {
        const beamX = ((beam + 0.5) / beamCount) * width;
        const beamWidth = width * (0.008 + levels.high * 0.02);
        const beamGradient = context.createLinearGradient(beamX, 0, beamX, height);
        beamGradient.addColorStop(0, "rgba(0,0,0,0)");
        beamGradient.addColorStop(0.45, `hsla(${hue + 120}, 100%, 78%, ${levels.high * 0.07 * strength})`);
        beamGradient.addColorStop(1, "rgba(0,0,0,0)");
        context.fillStyle = beamGradient;
        context.fillRect(beamX - beamWidth / 2, 0, beamWidth, height);
      }

      if (levels.beatPulse > 0.05) {
        context.fillStyle = `rgba(255,255,255,${levels.beatPulse * 0.055 * strength})`;
        context.fillRect(0, 0, width, height);
      }

      context.restore();
      animationFrame = window.requestAnimationFrame(draw);
    };

    animationFrame = window.requestAnimationFrame(draw);

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(animationFrame);
      context.clearRect(0, 0, width, height);
    };
  }, [active, intensity, levelsRef]);

  return <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 h-full w-full mix-blend-screen" />;
}
