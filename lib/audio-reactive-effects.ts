export const audioReactiveEffects = [
  {
    id: "bass-zoom",
    label: "Bass Zoom",
    description: "Punches the footage toward the audience with the low end."
  },
  {
    id: "hue-shift",
    label: "Hue Shift",
    description: "Rotates the footage color palette with the mids and highs."
  },
  {
    id: "contrast-pump",
    label: "Contrast Pump",
    description: "Drives contrast and saturation from the overall signal level."
  },
  {
    id: "focus-pulse",
    label: "Focus Pulse",
    description: "Pushes the footage in and out of focus with musical energy."
  },
  {
    id: "beat-invert",
    label: "Beat Invert",
    description: "Inverts the footage color on detected beat peaks."
  },
  {
    id: "glitch-jitter",
    label: "Glitch Jitter",
    description: "Jolts and skews the footage with high-frequency transients."
  },
  {
    id: "elastic-stretch",
    label: "Elastic Stretch",
    description: "Stretches the footage horizontally and vertically by frequency band."
  },
  {
    id: "monochrome-pulse",
    label: "Monochrome Pulse",
    description: "Pulls color out of the footage, then restores it on each beat."
  },
  {
    id: "heat-shift",
    label: "Heat Shift",
    description: "Warms and saturates the footage as the bass rises."
  },
  {
    id: "exposure-strobe",
    label: "Exposure Strobe",
    description: "Pumps the footage exposure on strong beat peaks."
  }
] as const;

export type AudioReactiveEffectId = (typeof audioReactiveEffects)[number]["id"];

export const defaultAudioReactiveEffect: AudioReactiveEffectId = "bass-zoom";
export const audioEffectCycleIntervalMs = 12_000;

const audioReactiveEffectIds = new Set<string>(audioReactiveEffects.map((effect) => effect.id));

export function isAudioReactiveEffectId(value: unknown): value is AudioReactiveEffectId {
  return typeof value === "string" && audioReactiveEffectIds.has(value);
}

export function getNextAudioReactiveEffect(currentEffect: AudioReactiveEffectId) {
  const currentIndex = audioReactiveEffects.findIndex((effect) => effect.id === currentEffect);
  return audioReactiveEffects[(currentIndex + 1) % audioReactiveEffects.length].id;
}

export function getAudioReactiveEffect(effectId: AudioReactiveEffectId) {
  return audioReactiveEffects.find((effect) => effect.id === effectId) ?? audioReactiveEffects[0];
}
