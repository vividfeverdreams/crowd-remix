"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { AudioCueDetector, type AudioCueKind } from "@/lib/audio-reactivity";

export type AudioInputStatus = "idle" | "requesting" | "connected" | "error";

export type AudioReactiveLevels = {
  energy: number;
  bass: number;
  mid: number;
  high: number;
  beatPulse: number;
};

export type AudioInputDevice = {
  deviceId: string;
  label: string;
};

export type AudioCueEvent = {
  id: number;
  kind: AudioCueKind;
  occurredAt: number;
};

const silentLevels: AudioReactiveLevels = {
  energy: 0,
  bass: 0,
  mid: 0,
  high: 0,
  beatPulse: 0
};

export function useAudioReactiveInput(enabled = true) {
  const levelsRef = useRef<AudioReactiveLevels>({ ...silentLevels });
  const [meterLevels, setMeterLevels] = useState<AudioReactiveLevels>(silentLevels);
  const [devices, setDevices] = useState<AudioInputDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [activeDeviceId, setActiveDeviceId] = useState("");
  const [status, setStatus] = useState<AudioInputStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastCue, setLastCue] = useState<AudioCueEvent | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const detectorRef = useRef(new AudioCueDetector());
  const connectionAttemptRef = useRef(0);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      return [];
    }

    try {
      const mediaDevices = await navigator.mediaDevices.enumerateDevices();
      const inputs = mediaDevices
        .filter((device) => device.kind === "audioinput")
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || `Audio input ${index + 1}`
        }));

      setDevices(inputs);
      setSelectedDeviceId((current) => {
        if (current && inputs.some((device) => device.deviceId === current)) {
          return current;
        }

        return inputs[0]?.deviceId ?? "";
      });

      return inputs;
    } catch {
      return [];
    }
  }, []);

  const releaseAudioResources = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    sourceRef.current?.disconnect();
    analyserRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((track) => track.stop());

    if (contextRef.current && contextRef.current.state !== "closed") {
      void contextRef.current.close();
    }

    streamRef.current = null;
    contextRef.current = null;
    sourceRef.current = null;
    analyserRef.current = null;
    detectorRef.current.reset();
    levelsRef.current = { ...silentLevels };
  }, []);

  const disconnect = useCallback(() => {
    connectionAttemptRef.current += 1;
    releaseAudioResources();
    setMeterLevels(silentLevels);
    setActiveDeviceId("");
    setStatus("idle");
    setError(null);
  }, [releaseAudioResources]);

  const connect = useCallback(
    async (deviceId = selectedDeviceId) => {
      if (!enabled) {
        return;
      }

      const attempt = connectionAttemptRef.current + 1;
      connectionAttemptRef.current = attempt;
      releaseAudioResources();
      setStatus("requesting");
      setError(null);

      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("error");
        setError("This browser does not expose audio inputs. Use a current Chrome, Edge, or Safari build over HTTPS.");
        return;
      }

      try {
        const audioConstraints: MediaTrackConstraints = {
          autoGainControl: false,
          echoCancellation: false,
          noiseSuppression: false,
          channelCount: {
            ideal: 2
          }
        };

        if (deviceId) {
          audioConstraints.deviceId = {
            exact: deviceId
          };
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints,
          video: false
        });

        if (connectionAttemptRef.current !== attempt) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        const context = new AudioContext({
          latencyHint: "interactive"
        });
        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.72;
        analyser.minDecibels = -90;
        analyser.maxDecibels = -20;
        source.connect(analyser);

        streamRef.current = stream;
        contextRef.current = context;
        sourceRef.current = source;
        analyserRef.current = analyser;
        detectorRef.current.reset();
        await context.resume();

        const activeTrack = stream.getAudioTracks()[0];
        const actualDeviceId = activeTrack?.getSettings().deviceId ?? deviceId;
        setActiveDeviceId(actualDeviceId ?? "");
        setSelectedDeviceId(actualDeviceId ?? deviceId);
        setStatus("connected");
        await refreshDevices();

        activeTrack?.addEventListener(
          "ended",
          () => {
            if (connectionAttemptRef.current !== attempt) {
              return;
            }

            releaseAudioResources();
            setMeterLevels(silentLevels);
            setActiveDeviceId("");
            setStatus("error");
            setError("The selected audio input disconnected. Choose an available input and reconnect.");
          },
          { once: true }
        );

        const timeData = new Float32Array(analyser.fftSize);
        const frequencyData = new Uint8Array(analyser.frequencyBinCount);
        let lastMeterUpdateAt = 0;
        let beatPulse = 0;

        const analyze = (atMs: number) => {
          if (connectionAttemptRef.current !== attempt || analyserRef.current !== analyser) {
            return;
          }

          analyser.getFloatTimeDomainData(timeData);
          analyser.getByteFrequencyData(frequencyData);

          let squareTotal = 0;
          for (const sample of timeData) {
            squareTotal += sample * sample;
          }

          const rms = Math.sqrt(squareTotal / timeData.length);
          const energy = clamp01(rms * 3.8);
          const bass = readFrequencyBand(frequencyData, context.sampleRate, analyser.fftSize, 35, 180);
          const mid = readFrequencyBand(frequencyData, context.sampleRate, analyser.fftSize, 180, 2200);
          const high = readFrequencyBand(frequencyData, context.sampleRate, analyser.fftSize, 2200, 9000);
          const detection = detectorRef.current.process({
            atMs,
            energy,
            bass,
            mid,
            high
          });

          beatPulse = detection.beat ? 1 : beatPulse * 0.88;
          const nextLevels = {
            energy,
            bass,
            mid,
            high,
            beatPulse
          };
          levelsRef.current = nextLevels;

          if (atMs - lastMeterUpdateAt >= 100) {
            lastMeterUpdateAt = atMs;
            setMeterLevels(nextLevels);
          }

          if (detection.cue) {
            setLastCue((current) => ({
              id: (current?.id ?? 0) + 1,
              kind: detection.cue as AudioCueKind,
              occurredAt: Date.now()
            }));
          }

          animationFrameRef.current = window.requestAnimationFrame(analyze);
        };

        animationFrameRef.current = window.requestAnimationFrame(analyze);
      } catch (connectionError) {
        if (connectionAttemptRef.current !== attempt) {
          return;
        }

        releaseAudioResources();
        setMeterLevels(silentLevels);
        setActiveDeviceId("");
        setStatus("error");
        setError(describeAudioInputError(connectionError));
      }
    },
    [enabled, refreshDevices, releaseAudioResources, selectedDeviceId]
  );

  useEffect(() => {
    if (!enabled || !navigator.mediaDevices) {
      return;
    }

    const handleDeviceChange = () => {
      void refreshDevices();
    };

    void refreshDevices();
    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);

    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", handleDeviceChange);
    };
  }, [enabled, refreshDevices]);

  useEffect(() => {
    return () => {
      connectionAttemptRef.current += 1;
      releaseAudioResources();
    };
  }, [releaseAudioResources]);

  return {
    activeDeviceId,
    connect,
    devices,
    disconnect,
    error,
    lastCue,
    levelsRef: levelsRef as MutableRefObject<AudioReactiveLevels>,
    meterLevels,
    selectedDeviceId,
    setSelectedDeviceId,
    status
  };
}

function readFrequencyBand(data: Uint8Array, sampleRate: number, fftSize: number, lowHz: number, highHz: number) {
  const binWidth = sampleRate / fftSize;
  const startIndex = Math.max(0, Math.floor(lowHz / binWidth));
  const endIndex = Math.min(data.length, Math.ceil(highHz / binWidth));

  if (endIndex <= startIndex) {
    return 0;
  }

  let total = 0;

  for (let index = startIndex; index < endIndex; index += 1) {
    total += data[index] ?? 0;
  }

  return clamp01(total / (endIndex - startIndex) / 255);
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function describeAudioInputError(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "Audio input permission was denied. Allow microphone access for this site, then reconnect.";
    }

    if (error.name === "NotFoundError" || error.name === "OverconstrainedError") {
      return "The selected audio input is unavailable. Connect the interface or choose another input.";
    }

    if (error.name === "NotReadableError") {
      return "Another application may be holding the audio input. Release it there, then reconnect.";
    }
  }

  return "The audio input could not be opened. Check the interface and browser permissions, then reconnect.";
}
