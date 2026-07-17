"use client";
import {
  audioEffectCycleIntervalMs,
  audioReactiveEffects,
  type AudioReactiveEffectId
} from "@/lib/audio-reactive-effects";
import type {
  AudioCueEvent,
  AudioInputDevice,
  AudioInputStatus,
  AudioReactiveLevels
} from "@/lib/use-audio-reactive-input";

type AudioSyncControlsProps = {
  activeDeviceId: string;
  autoCycleEffects: boolean;
  autoTakeOnCue: boolean;
  devices: AudioInputDevice[];
  error: string | null;
  intensity: number;
  lastCue: AudioCueEvent | null;
  levels: AudioReactiveLevels;
  nextReady: boolean;
  selectedDeviceId: string;
  selectedEffect: AudioReactiveEffectId;
  status: AudioInputStatus;
  transitionFeedback: string | null;
  transitionInFlight: boolean;
  onAutoCycleEffectsChange: (enabled: boolean) => void;
  onAutoTakeChange: (enabled: boolean) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onIntensityChange: (intensity: number) => void;
  onSelectedDeviceChange: (deviceId: string) => void;
  onSelectedEffectChange: (effect: AudioReactiveEffectId) => void;
  onTakeNext: () => void;
};

const meters: Array<{ key: keyof Pick<AudioReactiveLevels, "energy" | "bass" | "mid" | "high">; label: string }> = [
  { key: "energy", label: "Level" },
  { key: "bass", label: "Bass" },
  { key: "mid", label: "Mid" },
  { key: "high", label: "High" }
];

export function AudioSyncControls(props: AudioSyncControlsProps) {
  const connected = props.status === "connected";
  const selectedInputApplied = connected && props.selectedDeviceId === props.activeDeviceId;

  return (
    <section className="panel p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <span className={`h-2.5 w-2.5 rounded-full ${connected ? "bg-plasma shadow-[0_0_18px_rgba(16,214,160,0.9)]" : "bg-white/30"}`} />
            <p className="font-mono text-xs uppercase tracking-[0.3em] text-plasma">Audio Reactive Engine</p>
          </div>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-white/68">
            {connected
              ? "Dashboard input armed. Reactive levels and musical cues are being sent to the clean show output."
              : "Connect a mixer line input, audio interface, or virtual loopback here. Keep this dashboard open while the show window runs."}
          </p>
        </div>
        <span className="rounded-full border border-white/10 bg-black/25 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-white/55">
          {connected ? "Live" : "Off"}
        </span>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Audio input levels">
        {meters.map((meter) => (
          <Meter key={meter.key} label={meter.label} value={props.levels[meter.key]} />
        ))}
      </div>

      <label className="mt-6 block">
        <span className="mb-2 block text-xs font-medium text-white/65">Input device</span>
        <select
          value={props.selectedDeviceId}
          onChange={(event) => props.onSelectedDeviceChange(event.target.value)}
          className="w-full rounded-2xl border border-white/10 bg-black/55 px-3 py-2.5 text-sm text-white outline-none focus:border-plasma"
        >
          <option value="">Default audio input</option>
          {props.devices.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label}
            </option>
          ))}
        </select>
      </label>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={props.status === "requesting" || selectedInputApplied}
          onClick={props.onConnect}
          className="min-w-44 flex-1 rounded-full bg-white px-4 py-2.5 text-xs font-semibold text-ink transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {props.status === "requesting" ? "Opening input..." : selectedInputApplied ? "Input connected" : connected ? "Apply input" : "Connect input"}
        </button>
        {connected ? (
          <button
            type="button"
            onClick={props.onDisconnect}
            className="rounded-full border border-white/12 px-4 py-2.5 text-xs font-semibold text-white/70 hover:bg-white/10"
          >
            Disconnect
          </button>
        ) : null}
      </div>

      <label className="mt-5 block">
        <span className="flex items-center justify-between text-xs text-white/65">
          VFX intensity
          <span className="font-mono text-white/45">{Math.round(props.intensity * 100)}%</span>
        </span>
        <input
          type="range"
          min="0"
          max="1.5"
          step="0.05"
          value={props.intensity}
          onChange={(event) => props.onIntensityChange(Number(event.target.value))}
          className="mt-2 w-full accent-[#10d6a0]"
        />
      </label>

      <label className="mt-5 block">
        <span className="mb-2 block text-xs font-medium text-white/65">Audio-reactive effect</span>
        <select
          value={props.selectedEffect}
          onChange={(event) => props.onSelectedEffectChange(event.target.value as AudioReactiveEffectId)}
          className="w-full rounded-2xl border border-white/10 bg-black/55 px-3 py-2.5 text-sm text-white outline-none focus:border-plasma"
        >
          {audioReactiveEffects.map((effect) => (
            <option key={effect.id} value={effect.id}>
              {effect.label}
            </option>
          ))}
        </select>
      </label>

      <label className="mt-3 flex items-center gap-3 text-sm text-white/72">
        <input
          type="checkbox"
          checked={props.autoCycleEffects}
          onChange={(event) => props.onAutoCycleEffectsChange(event.target.checked)}
        />
        <span>
          Auto-cycle effects every {audioEffectCycleIntervalMs / 1000} seconds
        </span>
      </label>

      <label className="mt-4 flex items-start gap-3 rounded-3xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/72">
        <input
          type="checkbox"
          checked={props.autoTakeOnCue}
          onChange={(event) => props.onAutoTakeChange(event.target.checked)}
          className="mt-1"
        />
        <span>
          <span className="block font-semibold text-white/85">Take next remix on musical cue</span>
          <span className="mt-1 block text-xs leading-5 text-white/52">Builds and strong returns after quiet passages can trigger the crossfade.</span>
        </span>
      </label>

      <button
        type="button"
        disabled={!props.nextReady || props.transitionInFlight}
        onClick={props.onTakeNext}
        className="mt-3 w-full rounded-full border border-plasma/35 bg-plasma/10 px-4 py-2.5 text-xs font-semibold text-plasma transition hover:bg-plasma/20 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-transparent disabled:text-white/35"
      >
        {props.transitionInFlight ? "Crossfading..." : props.nextReady ? "Take next remix now" : "Waiting for next remix"}
      </button>

      <div className="mt-4 min-h-6 text-xs leading-5 text-white/55" aria-live="polite">
        {props.error ? <p role="alert" className="text-ember">{props.error}</p> : null}
        {!props.error && props.transitionFeedback ? <p>{props.transitionFeedback}</p> : null}
        {!props.error && !props.transitionFeedback && props.lastCue ? <p>{formatCueLabel(props.lastCue)} detected.</p> : null}
        {!props.error && !props.transitionFeedback && !props.lastCue ? (
          <p>{connected ? "Listening for beats, builds, and section changes." : "Without audio sync, ready remixes retain the existing automatic crossfade behavior in the show window."}</p>
        ) : null}
      </div>
    </section>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/30 px-2 py-2.5">
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-gradient-to-r from-tide via-plasma to-haze transition-[width] duration-100" style={{ width: `${Math.round(Math.min(1, value) * 100)}%` }} />
      </div>
      <p className="mt-2 text-center font-mono text-[9px] uppercase tracking-[0.16em] text-white/40">{label}</p>
    </div>
  );
}

function formatCueLabel(cue: AudioCueEvent) {
  return cue.kind === "build" ? "Build" : "Section change";
}
