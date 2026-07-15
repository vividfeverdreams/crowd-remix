export type AudioCueKind = "build" | "section-change";

export type AudioFeatures = {
  atMs: number;
  energy: number;
  bass: number;
  mid: number;
  high: number;
};

export type AudioCueDetection = {
  beat: boolean;
  cue: AudioCueKind | null;
};

const analysisWindowMs = 6000;
const beatCooldownMs = 240;
const cueCooldownMs = 8000;

export class AudioCueDetector {
  private samples: AudioFeatures[] = [];
  private beatTimes: number[] = [];
  private lastBeatAt = Number.NEGATIVE_INFINITY;
  private lastCueAt = Number.NEGATIVE_INFINITY;
  private quietStartedAt: number | null = null;
  private quietBaseline = 0;
  private buildStartedAt: number | null = null;
  private spectralShiftStartedAt: number | null = null;

  process(features: AudioFeatures): AudioCueDetection {
    const recentSamples = this.samples.filter((sample) => features.atMs - sample.atMs <= 2200);
    const baselineEnergy = Math.max(0.015, average(recentSamples, "energy"));
    const baselineBass = Math.max(0.015, average(recentSamples, "bass"));
    const beat =
      features.atMs - this.lastBeatAt >= beatCooldownMs &&
      features.energy >= Math.max(0.08, baselineEnergy * 1.28) &&
      features.bass >= Math.max(0.12, baselineBass * 1.42);

    if (beat) {
      this.lastBeatAt = features.atMs;
      this.beatTimes.push(features.atMs);
    }

    this.beatTimes = this.beatTimes.filter((atMs) => features.atMs - atMs <= 3500);

    const ambientSamples = this.samples.filter((sample) => features.atMs - sample.atMs <= 3600);
    const ambientEnergy = Math.max(0.05, average(ambientSamples, "energy"));
    const quietThreshold = Math.max(0.025, ambientEnergy * 0.4);
    const cueAvailable = features.atMs - this.lastCueAt >= cueCooldownMs;
    let cue: AudioCueKind | null = null;

    if (features.energy <= quietThreshold) {
      if (this.quietStartedAt === null) {
        this.quietStartedAt = features.atMs;
        this.quietBaseline = ambientEnergy;
      }

      this.buildStartedAt = null;
    } else if (this.quietStartedAt !== null) {
      const quietDuration = features.atMs - this.quietStartedAt;
      const strongReturn =
        features.energy >= Math.max(0.11, this.quietBaseline * 1.2) &&
        features.bass >= Math.max(0.12, baselineBass * 1.2);

      if (quietDuration >= 850 && strongReturn && cueAvailable) {
        cue = "section-change";
      }

      this.quietStartedAt = null;
      this.quietBaseline = 0;
    }

    this.samples.push(features);
    this.samples = this.samples.filter((sample) => features.atMs - sample.atMs <= analysisWindowMs);

    if (!cue) {
      const older = this.samples.filter((sample) => {
        const age = features.atMs - sample.atMs;
        return age >= 2200 && age <= 5200;
      });
      const newest = this.samples.filter((sample) => features.atMs - sample.atMs <= 1100);
      const olderEnergy = average(older, "energy");
      const newestEnergy = average(newest, "energy");
      const olderHigh = average(older, "high");
      const newestHigh = average(newest, "high");
      const spectralDelta = compareSpectralProfiles(older, newest);
      const energyRatio = newestEnergy / Math.max(0.03, olderEnergy);
      const spectralShiftCandidate =
        older.length >= 8 &&
        newest.length >= 6 &&
        newestEnergy >= 0.08 &&
        energyRatio >= 0.65 &&
        energyRatio <= 1.4 &&
        spectralDelta >= 0.36;

      if (spectralShiftCandidate) {
        this.spectralShiftStartedAt ??= features.atMs;

        if (features.atMs - this.spectralShiftStartedAt >= 900 && cueAvailable) {
          cue = "section-change";
          this.spectralShiftStartedAt = null;
        }
      } else {
        this.spectralShiftStartedAt = null;
      }

      const risingEnergy = older.length >= 8 && newest.length >= 6 && newestEnergy >= Math.max(0.14, olderEnergy * 1.45);
      const brightening = newestHigh >= Math.max(0.08, olderHigh * 1.22);
      const beatDensity = this.beatTimes.length >= 3;
      const buildCandidate = risingEnergy && brightening && beatDensity;

      if (!cue && buildCandidate) {
        this.buildStartedAt ??= features.atMs;

        if (features.atMs - this.buildStartedAt >= 650 && cueAvailable) {
          cue = "build";
          this.buildStartedAt = null;
        }
      } else {
        this.buildStartedAt = null;
      }
    }

    if (cue) {
      this.lastCueAt = features.atMs;
    }

    return {
      beat,
      cue
    };
  }

  reset() {
    this.samples = [];
    this.beatTimes = [];
    this.lastBeatAt = Number.NEGATIVE_INFINITY;
    this.lastCueAt = Number.NEGATIVE_INFINITY;
    this.quietStartedAt = null;
    this.quietBaseline = 0;
    this.buildStartedAt = null;
    this.spectralShiftStartedAt = null;
  }
}

function average(samples: AudioFeatures[], key: keyof Omit<AudioFeatures, "atMs">) {
  if (samples.length === 0) {
    return 0;
  }

  let total = 0;

  for (const sample of samples) {
    total += sample[key];
  }

  return total / samples.length;
}

function compareSpectralProfiles(older: AudioFeatures[], newest: AudioFeatures[]) {
  if (older.length === 0 || newest.length === 0) {
    return 0;
  }

  const olderBands = [average(older, "bass"), average(older, "mid"), average(older, "high")];
  const newestBands = [average(newest, "bass"), average(newest, "mid"), average(newest, "high")];
  const olderTotal = Math.max(0.01, olderBands[0] + olderBands[1] + olderBands[2]);
  const newestTotal = Math.max(0.01, newestBands[0] + newestBands[1] + newestBands[2]);
  let delta = 0;

  for (let index = 0; index < olderBands.length; index += 1) {
    delta += Math.abs((olderBands[index] ?? 0) / olderTotal - (newestBands[index] ?? 0) / newestTotal);
  }

  return delta;
}
