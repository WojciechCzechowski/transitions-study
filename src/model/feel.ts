import { lerpBezier, type Bezier } from './easing';
import { clampDuration, MIN_TRANSITION_DURATION, type ClampResult, type Limits } from './timeline';
import { clamp, lerp, roundToEven, type Frames } from './time';

export const FEEL_MIN = 0;
export const FEEL_MAX = 100;

/** One end of the Feel slider for a preset. */
export interface FeelEndpoint {
  /** Duration in frames. Rounded to even when mapped. */
  readonly frames: Frames;
  readonly bezier: Bezier;
  /** Preset-specific 0…1 strength; see the preset's doc comment in the config. */
  readonly intensity: number;
}

export interface FeelDefinition {
  readonly snappy: FeelEndpoint;
  readonly smooth: FeelEndpoint;
}

export interface FeelParams {
  /** Duration after clamping to the available handles. */
  readonly duration: Frames;
  /** Duration Feel asked for before clamping. */
  readonly requested: Frames;
  readonly clamped: ClampResult['clamped'];
  readonly bezier: Bezier;
  readonly intensity: number;
}

export function normalizeFeel(feel: number): number {
  return Math.round(clamp(feel, FEEL_MIN, FEEL_MAX));
}

const feelT = (feel: number) => normalizeFeel(feel) / FEEL_MAX;

/** Duration Feel asks for, ignoring handle limits. Always even and ≥ the minimum. */
export function feelDuration(feel: number, def: FeelDefinition): Frames {
  const raw = lerp(def.snappy.frames, def.smooth.frames, feelT(feel));
  return Math.max(MIN_TRANSITION_DURATION, roundToEven(raw));
}

export function feelEasing(feel: number, def: FeelDefinition): Bezier {
  return lerpBezier(def.snappy.bezier, def.smooth.bezier, feelT(feel));
}

export function feelIntensity(feel: number, def: FeelDefinition): number {
  return lerp(def.snappy.intensity, def.smooth.intensity, feelT(feel));
}

/** One Feel value → duration, easing and intensity together. */
export function feelToParams(feel: number, def: FeelDefinition, limits: Limits): FeelParams {
  const requested = feelDuration(feel, def);
  const { duration, clamped } = clampDuration(requested, limits);
  return {
    duration,
    requested,
    clamped,
    bezier: feelEasing(feel, def),
    intensity: feelIntensity(feel, def),
  };
}
