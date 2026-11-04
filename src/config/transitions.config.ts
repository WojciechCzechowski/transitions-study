/**
 * Every tunable transition value lives here. Edit and save; Vite hot-reloads.
 *
 * Feel: 0 = snappy … 100 = smooth. Each preset defines both ends; the slider
 * interpolates the easing curve's control points and an intensity whose meaning
 * is preset-specific (see each preset). Feel never changes duration: a new
 * transition starts at TRANSITION_DEFAULTS.duration and only its edges resize it.
 * Fine-tune can override the curve (one of EASING_CURVES) and the intensity.
 *
 * Coordinates in shader params are screen space: x right, y down.
 */
import type { Bezier } from '../model/easing';
import type { FeelDefinition } from '../model/feel';

export type PresetId = 'crossDissolve' | 'dipToBlack' | 'push' | 'wipe' | 'zoom' | 'blur';

export interface PresetConfig {
  readonly id: PresetId;
  readonly name: string;
  /** One-line description shown in the gallery. */
  readonly hint: string;
  /** What `intensity` controls, shown in Fine-tune. */
  readonly intensityLabel: string;
  readonly feel: FeelDefinition;
  /** Free per-preset shader parameters (uParams). */
  readonly params: readonly [number, number, number, number];
}

// Shared curve endpoints. Snappy: fast start, long settle. Smooth: symmetric ease-in-out.
const SNAPPY: Bezier = [0.22, 1, 0.36, 1];
const SMOOTH: Bezier = [0.45, 0, 0.55, 1];

export const PRESETS: readonly PresetConfig[] = [
  {
    id: 'crossDissolve',
    name: 'Cross dissolve',
    hint: 'Blend A into B',
    // intensity: brightness dip at the midpoint (0 = straight mix, 0.3 = noticeable dip).
    intensityLabel: 'Midpoint dip',
    feel: {
      snappy: { bezier: SNAPPY, intensity: 0 },
      smooth: { bezier: SMOOTH, intensity: 0.12 },
    },
    params: [0, 0, 0, 0],
  },
  {
    id: 'dipToBlack',
    name: 'Dip to black',
    hint: 'Fade out, then in',
    // intensity: share of the duration spent fully black (0 = passes straight through).
    // params[0]: depth (1 = full black, 0.8 = dark grey).
    intensityLabel: 'Hold at black',
    feel: {
      snappy: { bezier: SNAPPY, intensity: 0 },
      smooth: { bezier: SMOOTH, intensity: 0.3 },
    },
    params: [1, 0, 0, 0],
  },
  {
    id: 'push',
    name: 'Push',
    hint: 'B pushes A out',
    // intensity: directional motion blur along the push (0 = none, 1 = strong).
    // params[0,1]: direction the picture moves (-1, 0 = leftwards, B enters from the right).
    // params[2]: blur length as a fraction of the frame at intensity 1.
    intensityLabel: 'Motion blur',
    feel: {
      snappy: { bezier: SNAPPY, intensity: 0.9 },
      smooth: { bezier: SMOOTH, intensity: 0.25 },
    },
    params: [-1, 0, 0.12, 0],
  },
  {
    id: 'wipe',
    name: 'Wipe',
    hint: 'A soft edge sweeps across',
    // intensity: edge feather (0 = hard line, 1 = feather half the frame wide).
    // params[0,1]: direction the edge travels (1, 0 = left to right).
    intensityLabel: 'Edge feather',
    feel: {
      snappy: { bezier: SNAPPY, intensity: 0.02 },
      smooth: { bezier: SMOOTH, intensity: 0.35 },
    },
    params: [1, 0, 0, 0],
  },
  {
    id: 'zoom',
    name: 'Zoom',
    hint: 'Punch in through the cut',
    // intensity: zoom amount (0.5 = A scales to 1.5× as it leaves, B settles from 1.5×).
    // params[0]: radial blur strength at the midpoint.
    intensityLabel: 'Zoom amount',
    feel: {
      snappy: { bezier: SNAPPY, intensity: 0.7 },
      smooth: { bezier: SMOOTH, intensity: 0.25 },
    },
    params: [0.35, 0, 0, 0],
  },
  {
    id: 'blur',
    name: 'Blur',
    hint: 'Defocus, swap, refocus',
    // intensity: peak blur radius (1 = params[0] of the frame height).
    // params[0]: radius at intensity 1, as a fraction of frame height.
    intensityLabel: 'Blur radius',
    feel: {
      snappy: { bezier: SNAPPY, intensity: 0.45 },
      smooth: { bezier: SMOOTH, intensity: 1 },
    },
    params: [0.05, 0, 0, 0],
  },
];

export const PRESET_BY_ID: Readonly<Record<PresetId, PresetConfig>> = Object.fromEntries(
  PRESETS.map((p) => [p.id, p]),
) as Record<PresetId, PresetConfig>;

export function getPreset(id: string): PresetConfig {
  const p = (PRESET_BY_ID as Record<string, PresetConfig | undefined>)[id];
  if (!p) throw new Error(`Unknown preset "${id}"`);
  return p;
}

/** Curves Fine-tune offers. Snappy and Smooth are the Feel slider's ends. */
export const EASING_CURVES: readonly { readonly id: string; readonly name: string; readonly bezier: Bezier }[] = [
  { id: 'linear', name: 'Linear', bezier: [0, 0, 1, 1] },
  { id: 'easeIn', name: 'Ease in', bezier: [0.42, 0, 1, 1] },
  { id: 'easeOut', name: 'Ease out', bezier: [0, 0, 0.58, 1] },
  { id: 'snappy', name: 'Snappy', bezier: SNAPPY },
  { id: 'smooth', name: 'Smooth', bezier: SMOOTH },
];

export const TRANSITION_DEFAULTS = {
  /** Feel used for a brand-new transition and for previews before one exists. */
  feel: 50,
  /** Duration (frames, even) of a brand-new transition, before the clips' length caps it. */
  duration: 24,
  preview: {
    /** Frames of clip A shown before the transition starts in the gallery loop. */
    leadIn: 12,
    /** Frames of clip B shown after it ends. */
    tail: 12,
    /** Frames to hold the last frame before the loop restarts. */
    hold: 10,
  },
} as const;
