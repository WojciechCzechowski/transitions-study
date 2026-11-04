import { lerpBezier, type Bezier } from './easing';
import { clamp, lerp } from './time';

export const FEEL_MIN = 0;
export const FEEL_MAX = 100;
export const INTENSITY_MIN = 0;
export const INTENSITY_MAX = 1;

/** One end of the Feel slider for a preset. */
export interface FeelEndpoint {
  readonly bezier: Bezier;
  /** Preset-specific 0…1 strength; see the preset's doc comment in the config. */
  readonly intensity: number;
}

export interface FeelDefinition {
  readonly snappy: FeelEndpoint;
  readonly smooth: FeelEndpoint;
}

/** How a transition moves. Duration is separate: only the timeline edges change it. */
export interface FeelParams {
  readonly bezier: Bezier;
  readonly intensity: number;
}

/** Feel plus the Fine-tune overrides that replace what Feel gives. */
export interface Tuning {
  readonly feel: number;
  readonly easing?: Bezier;
  readonly intensity?: number;
}

export function normalizeFeel(feel: number): number {
  return Math.round(clamp(feel, FEEL_MIN, FEEL_MAX));
}

export function normalizeIntensity(value: number): number {
  return Math.round(clamp(value, INTENSITY_MIN, INTENSITY_MAX) * 100) / 100;
}

const feelT = (feel: number) => normalizeFeel(feel) / FEEL_MAX;

export function feelEasing(feel: number, def: FeelDefinition): Bezier {
  return lerpBezier(def.snappy.bezier, def.smooth.bezier, feelT(feel));
}

export function feelIntensity(feel: number, def: FeelDefinition): number {
  return lerp(def.snappy.intensity, def.smooth.intensity, feelT(feel));
}

/** One Feel value → easing and intensity together. */
export function feelToParams(feel: number, def: FeelDefinition): FeelParams {
  return { bezier: feelEasing(feel, def), intensity: feelIntensity(feel, def) };
}

/** What a transition renders with: each override wins over Feel. */
export function tuningParams(t: Tuning, def: FeelDefinition): FeelParams {
  return {
    bezier: t.easing ?? feelEasing(t.feel, def),
    intensity: t.intensity ?? feelIntensity(t.feel, def),
  };
}

export const isTuned = (t: Tuning) => t.easing !== undefined || t.intensity !== undefined;
