import { describe, expect, it } from "vitest";
import {
  audioReactiveEffects,
  defaultAudioReactiveEffect,
  getNextAudioReactiveEffect,
  isAudioReactiveEffectId
} from "@/lib/audio-reactive-effects";
import { getAudioReactiveVisualStyle } from "@/lib/use-audio-reactive-visual-effect";

describe("audio-reactive effects", () => {
  it("provides ten uniquely named effects", () => {
    expect(audioReactiveEffects).toHaveLength(10);
    expect(new Set(audioReactiveEffects.map((effect) => effect.id)).size).toBe(10);
    expect(new Set(audioReactiveEffects.map((effect) => effect.label)).size).toBe(10);
    expect(audioReactiveEffects.every((effect) => effect.description.length > 0)).toBe(true);
  });

  it("recognizes only supported effect identifiers", () => {
    expect(isAudioReactiveEffectId(defaultAudioReactiveEffect)).toBe(true);
    expect(isAudioReactiveEffectId("exposure-strobe")).toBe(true);
    expect(isAudioReactiveEffectId("mystery-effect")).toBe(false);
  });

  it("cycles through every effect and wraps to the first", () => {
    let effect = defaultAudioReactiveEffect;
    const visited = [effect];

    for (let index = 1; index < audioReactiveEffects.length; index += 1) {
      effect = getNextAudioReactiveEffect(effect);
      visited.push(effect);
    }

    expect(new Set(visited).size).toBe(audioReactiveEffects.length);
    expect(getNextAudioReactiveEffect(effect)).toBe(defaultAudioReactiveEffect);
  });

  it("produces ten distinct transformations of the visual", () => {
    const levels = {
      energy: 0.72,
      bass: 0.82,
      mid: 0.58,
      high: 0.66,
      beatPulse: 0.74
    };
    const styles = audioReactiveEffects.map((effect) =>
      getAudioReactiveVisualStyle(effect.id, levels, 0.85, 1.25)
    );

    expect(new Set(styles.map((style) => `${style.filter}|${style.transform}`)).size).toBe(10);
    expect(styles.every((style) => style.filter.length > 0 && style.transform.length > 0)).toBe(true);
  });
});
