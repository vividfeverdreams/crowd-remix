import { describe, expect, it } from "vitest";
import { AudioCueDetector, type AudioFeatures } from "@/lib/audio-reactivity";

describe("AudioCueDetector", () => {
  it("marks a strong low-frequency transient as a beat", () => {
    const detector = new AudioCueDetector();

    for (let index = 0; index < 20; index += 1) {
      detector.process(frame(index * 100, 0.08, 0.08, 0.06));
    }

    const result = detector.process(frame(2000, 0.28, 0.48, 0.12));

    expect(result.beat).toBe(true);
    expect(result.cue).toBeNull();
  });

  it("detects a strong return after a quiet passage as a section change", () => {
    const detector = new AudioCueDetector();

    for (let index = 0; index < 25; index += 1) {
      detector.process(frame(index * 100, 0.2, 0.2, 0.14));
    }

    for (let index = 25; index < 37; index += 1) {
      detector.process(frame(index * 100, 0.01, 0.01, 0.01));
    }

    const result = detector.process(frame(3700, 0.36, 0.5, 0.22));

    expect(result.cue).toBe("section-change");
  });

  it("detects a sustained rise in energy and brightness as a build", () => {
    const detector = new AudioCueDetector();
    let detectedCue: string | null = null;

    for (let index = 0; index < 35; index += 1) {
      const bass = index % 4 === 0 ? 0.18 : 0.08;
      detector.process(frame(index * 100, 0.09, bass, 0.06));
    }

    for (let index = 35; index < 62; index += 1) {
      const progress = (index - 35) / 27;
      const energy = 0.12 + progress * 0.24;
      const bass = index % 3 === 0 ? 0.42 : 0.16 + progress * 0.12;
      const high = 0.09 + progress * 0.2;
      const result = detector.process(frame(index * 100, energy, bass, high));

      detectedCue ??= result.cue;
    }

    expect(detectedCue).toBe("build");
  });

  it("detects a sustained spectral change at a similar level as a probable song change", () => {
    const detector = new AudioCueDetector();
    let detectedCue: string | null = null;

    for (let index = 0; index < 40; index += 1) {
      detector.process({
        atMs: index * 100,
        energy: 0.2,
        bass: 0.1,
        mid: 0.24,
        high: 0.12
      });
    }

    for (let index = 40; index < 66; index += 1) {
      const result = detector.process({
        atMs: index * 100,
        energy: 0.21,
        bass: 0.34,
        mid: 0.08,
        high: 0.04
      });

      detectedCue ??= result.cue;
    }

    expect(detectedCue).toBe("section-change");
  });
});

function frame(atMs: number, energy: number, bass: number, high: number): AudioFeatures {
  return {
    atMs,
    energy,
    bass,
    mid: (energy + high) / 2,
    high
  };
}
