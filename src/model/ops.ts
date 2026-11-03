import { feelToParams, normalizeFeel, type FeelDefinition } from './feel';
import { clampDuration, getLimits, type ClampResult, type Doc, type Limits, type Transition } from './timeline';

export const DEFAULT_TRANSITION_ID = 'transition';

export type ApplyResult =
  | {
      readonly ok: true;
      readonly doc: Doc;
      /** True when an existing transition's preset was swapped. */
      readonly replaced: boolean;
      readonly clamped: ClampResult['clamped'];
    }
  | { readonly ok: false; readonly error: 'no-handles'; readonly limits: Limits };

export interface ApplyOptions {
  /** Feel for a new transition. Ignored when replacing (the existing feel is kept). */
  readonly feel: number;
  readonly id?: string;
}

/**
 * Apply a preset as one centred transition spanning the cut.
 * - No transition yet: create one; its duration comes from Feel, clamped to the handles.
 * - A transition exists: swap the preset, keeping duration and feel.
 * - Not enough handle on either side: refuse with the limits so the UI can explain.
 */
export function applyTransition(
  doc: Doc,
  presetId: string,
  feelDef: FeelDefinition,
  options: ApplyOptions,
): ApplyResult {
  const limits = getLimits(doc);
  if (!limits.canTransition) return { ok: false, error: 'no-handles', limits };

  const existing = doc.transition;
  if (existing) {
    const { duration, clamped } = clampDuration(existing.duration, limits);
    if (existing.presetId === presetId && duration === existing.duration) {
      return { ok: true, doc, replaced: false, clamped: null };
    }
    return {
      ok: true,
      doc: { ...doc, transition: { ...existing, presetId, duration } },
      replaced: true,
      clamped,
    };
  }

  const feel = normalizeFeel(options.feel);
  const params = feelToParams(feel, feelDef, limits);
  const transition: Transition = {
    id: options.id ?? DEFAULT_TRANSITION_ID,
    presetId,
    duration: params.duration,
    feel,
  };
  return { ok: true, doc: { ...doc, transition }, replaced: false, clamped: params.clamped };
}

export function removeTransition(doc: Doc): Doc {
  return doc.transition ? { ...doc, transition: null } : doc;
}

export interface EditResult {
  readonly doc: Doc;
  readonly clamped: ClampResult['clamped'];
}

/** Set the duration (symmetric around the cut), clamped to the handles. */
export function setDuration(doc: Doc, requested: number): EditResult {
  const t = doc.transition;
  if (!t) return { doc, clamped: null };
  const { duration, clamped } = clampDuration(requested, getLimits(doc));
  if (duration === t.duration) return { doc, clamped };
  return { doc: { ...doc, transition: { ...t, duration } }, clamped };
}

/** Feel sets duration, easing and intensity together; duration is clamped to the handles. */
export function setFeel(doc: Doc, feel: number, feelDef: FeelDefinition): EditResult {
  const t = doc.transition;
  if (!t) return { doc, clamped: null };
  const f = normalizeFeel(feel);
  const params = feelToParams(f, feelDef, getLimits(doc));
  if (f === t.feel && params.duration === t.duration) return { doc, clamped: params.clamped };
  return { doc: { ...doc, transition: { ...t, feel: f, duration: params.duration } }, clamped: params.clamped };
}
