import type { Bezier } from './easing';
import { normalizeFeel, normalizeIntensity } from './feel';
import {
  clampDuration,
  clipFromSource,
  clipIndexAt,
  clipIndexById,
  clipStarts,
  cutByKey,
  cutKeyOf,
  getLimits,
  NO_ROOM,
  normalize,
  roomFor,
  timelineLength,
  transitionAt,
  visibleLength,
  type ClampResult,
  type Clip,
  type Cut,
  type Doc,
  type Limits,
  type Room,
  type Source,
  type Transition,
} from './timeline';
import type { Frames } from './time';

// ---------------------------------------------------------------------------
// Transitions (per cut)

export type ApplyResult =
  | {
      readonly ok: true;
      readonly doc: Doc;
      /** True when an existing transition's preset was swapped. */
      readonly replaced: boolean;
      readonly clamped: ClampResult['clamped'];
      readonly transition: Transition;
      /** Frames trimmed off the clips to make room (NO_ROOM when the handles were enough). */
      readonly trimmed: Room;
    }
  | { readonly ok: false; readonly error: 'no-handles' | 'no-cut'; readonly limits: Limits | null };

export interface ApplyOptions {
  /** Feel for a new transition. Ignored when replacing (the existing feel is kept). */
  readonly feel: number;
  /** Duration for a new transition, clamped to what the clips can give. Ignored when replacing. */
  readonly duration: Frames;
}

const withTransitions = (doc: Doc, transitions: readonly Transition[]): Doc => ({ ...doc, transitions });

const replaceTransition = (doc: Doc, from: Transition, to: Transition): Doc =>
  withTransitions(doc, doc.transitions.map((t) => (t === from ? to : t)));

/** A transition with the given Fine-tune overrides (undefined drops one). */
function tuned(t: Transition, easing: Bezier | undefined, intensity: number | undefined): Transition {
  const { id, fromId, toId, presetId, duration, feel } = t;
  return {
    id,
    fromId,
    toId,
    presetId,
    duration,
    feel,
    ...(easing !== undefined && { easing }),
    ...(intensity !== undefined && { intensity }),
  };
}

/**
 * Make room for a centred transition of `duration` at `cut`: trim the outgoing
 * clip's end and the incoming clip's start by whatever their handles lack, so
 * those frames become handle. Later clips shift left. `duration` must be
 * within the cut's limits.
 */
function fitAtCut(doc: Doc, cut: Cut, duration: Frames): { doc: Doc; trimmed: Room } {
  const trimmed = roomFor(cut, duration);
  if (trimmed === NO_ROOM) return { doc, trimmed };
  const clips = doc.clips.map((c) => {
    if (c.id === cut.from.id) return { ...c, sourceOut: c.sourceOut - trimmed.a };
    if (c.id === cut.to.id) return { ...c, sourceIn: c.sourceIn + trimmed.b };
    return c;
  });
  return { doc: { ...doc, clips }, trimmed };
}

/**
 * Apply a preset as a centred transition on one cut.
 * - No transition there yet: create one at the given duration, clamped to what
 *   the clips can give, trimming them where their handles are short.
 * - A transition exists: swap the preset, keeping duration, feel and a Fine-tuned curve.
 *   A Fine-tuned intensity is dropped, since intensity means something else per preset.
 * - A clip too short to give even the minimum: refuse with the limits so the UI can explain.
 */
export function applyTransition(
  doc: Doc,
  cutKey: string,
  presetId: string,
  options: ApplyOptions,
): ApplyResult {
  const cut = cutByKey(doc, cutKey);
  if (!cut) return { ok: false, error: 'no-cut', limits: null };
  const limits = getLimits(doc, cut);
  if (!limits.canTransition) return { ok: false, error: 'no-handles', limits };

  const existing = transitionAt(doc, cutKey);
  if (existing) {
    const { duration, clamped } = clampDuration(existing.duration, limits);
    if (existing.presetId === presetId && duration === existing.duration) {
      return { ok: true, doc, replaced: false, clamped: null, transition: existing, trimmed: NO_ROOM };
    }
    const next = { ...tuned(existing, existing.easing, undefined), presetId, duration };
    return {
      ok: true,
      doc: replaceTransition(doc, existing, next),
      replaced: true,
      clamped,
      transition: next,
      trimmed: NO_ROOM,
    };
  }

  const { duration, clamped } = clampDuration(options.duration, limits);
  const room = fitAtCut(doc, cut, duration);
  const transition: Transition = {
    id: `t${doc.nextId}`,
    fromId: cut.from.id,
    toId: cut.to.id,
    presetId,
    duration,
    feel: normalizeFeel(options.feel),
  };
  const base = room.doc;
  return {
    ok: true,
    doc: normalize({ ...base, transitions: [...base.transitions, transition], nextId: base.nextId + 1 }),
    replaced: false,
    clamped,
    transition,
    trimmed: room.trimmed,
  };
}

export function removeTransition(doc: Doc, cutKey: string): Doc {
  const t = transitionAt(doc, cutKey);
  return t ? withTransitions(doc, doc.transitions.filter((x) => x !== t)) : doc;
}

export interface EditResult {
  readonly doc: Doc;
  readonly clamped: ClampResult['clamped'];
  /** Frames trimmed off the clips to make room for a longer transition. */
  readonly trimmed: Room;
}

/**
 * Set the duration (symmetric around the cut), clamped to what the clips can
 * give. Growing past the handles trims the clips to make room; shrinking
 * leaves the clips as they are, so the frames stay as handle.
 */
export function setDuration(doc: Doc, cutKey: string, requested: number): EditResult {
  const t = transitionAt(doc, cutKey);
  const cut = cutByKey(doc, cutKey);
  if (!t || !cut) return { doc, clamped: null, trimmed: NO_ROOM };
  const { duration, clamped } = clampDuration(requested, getLimits(doc, cut));
  if (duration === t.duration) return { doc, clamped, trimmed: NO_ROOM };
  const room = fitAtCut(doc, cut, duration);
  const next = transitionAt(room.doc, cutKey)!;
  return { doc: normalize(replaceTransition(room.doc, next, { ...next, duration })), clamped, trimmed: room.trimmed };
}

/** Feel sets easing and intensity together, replacing any Fine-tune overrides. Duration is untouched. */
export function setFeel(doc: Doc, cutKey: string, feel: number): Doc {
  const t = transitionAt(doc, cutKey);
  if (!t) return doc;
  const f = normalizeFeel(feel);
  if (f === t.feel && t.easing === undefined && t.intensity === undefined) return doc;
  return replaceTransition(doc, t, { ...tuned(t, undefined, undefined), feel: f });
}

/** Fine-tune: use this curve instead of the one from Feel. */
export function setEasing(doc: Doc, cutKey: string, easing: Bezier): Doc {
  const t = transitionAt(doc, cutKey);
  if (!t || (t.easing && t.easing.every((v, i) => v === easing[i]))) return doc;
  return replaceTransition(doc, t, tuned(t, easing, t.intensity));
}

/** Fine-tune: use this intensity (0…1) instead of the one from Feel. */
export function setIntensity(doc: Doc, cutKey: string, intensity: number): Doc {
  const t = transitionAt(doc, cutKey);
  const v = normalizeIntensity(intensity);
  if (!t || t.intensity === v) return doc;
  return replaceTransition(doc, t, tuned(t, t.easing, v));
}

/** Drop the Fine-tune overrides, so Feel drives easing and intensity again. */
export function resetTuning(doc: Doc, cutKey: string): Doc {
  const t = transitionAt(doc, cutKey);
  if (!t || (t.easing === undefined && t.intensity === undefined)) return doc;
  return replaceTransition(doc, t, tuned(t, undefined, undefined));
}

// ---------------------------------------------------------------------------
// Clips (magnetic: no gaps, later clips shift)

/**
 * Visible range for a freshly inserted source: all of it. Its cuts still take
 * transitions; applying one trims the clip to make the handles it needs.
 */
export function insertRange(frames: Frames): SourceRange {
  return { sourceIn: 0, sourceOut: Math.max(1, frames) };
}

export interface SourceRange {
  readonly sourceIn: Frames;
  /** Exclusive. */
  readonly sourceOut: Frames;
}

/** Insert all of `source` at clip boundary `index` (0 … clips.length). */
export function insertClip(doc: Doc, source: Source, index: number): { doc: Doc; clip: Clip } {
  return insertClipRange(doc, source, index, insertRange(source.frames));
}

/** Insert the `range` part of `source` at clip boundary `index` (0 … clips.length). */
export function insertClipRange(doc: Doc, source: Source, index: number, range: SourceRange): { doc: Doc; clip: Clip } {
  const at = Math.max(0, Math.min(doc.clips.length, Math.round(index)));
  const sourceIn = Math.max(0, Math.min(source.frames - 1, Math.round(range.sourceIn)));
  const sourceOut = Math.max(sourceIn + 1, Math.min(source.frames, Math.round(range.sourceOut)));
  const clip = clipFromSource(source, `c${doc.nextId}`, sourceIn, sourceOut);
  const clips = [...doc.clips.slice(0, at), clip, ...doc.clips.slice(at)];
  return { doc: normalize({ ...doc, clips, nextId: doc.nextId + 1 }), clip };
}

export type InsertAtResult =
  | { ok: true; doc: Doc; clip: Clip; /** Timeline frame where the new clip starts. */ at: Frames }
  | { ok: false; reason: 'in-transition'; transition: Transition };

/**
 * Insert at timeline frame t, rippling later clips right. Inside a clip it
 * splits that clip and puts the new one in the gap; on a cut, or at either
 * end of the timeline, it goes straight in. Refused inside a transition
 * (including exactly on a cut that has one), since that would remove it.
 */
export function insertAtFrame(doc: Doc, source: Source, t: Frames, range: SourceRange): InsertAtResult {
  const len = timelineLength(doc);
  let base = doc;
  let index: number;
  if (doc.clips.length === 0 || t <= 0) {
    index = 0;
  } else if (t >= len) {
    index = doc.clips.length;
  } else {
    const i = clipIndexAt(doc, t);
    if (t === clipStarts(doc)[i]) {
      const tr = transitionAt(doc, cutKeyOf(doc.clips[i - 1]!.id, doc.clips[i]!.id));
      if (tr) return { ok: false, reason: 'in-transition', transition: tr };
      index = i;
    } else {
      const split = splitClip(doc, t);
      if (!split.ok) {
        if (split.reason === 'in-transition' && split.transition) return { ok: false, reason: 'in-transition', transition: split.transition };
        index = i;
      } else {
        base = split.doc;
        index = clipIndexById(base, split.right.id);
      }
    }
  }
  const r = insertClipRange(base, source, index, range);
  const at = clipStarts(r.doc)[clipIndexById(r.doc, r.clip.id)] ?? 0;
  return { ok: true, doc: r.doc, clip: r.clip, at };
}

/** Move a clip to boundary `toIndex` of the current order. Same reference when it wouldn't move. */
export function moveClip(doc: Doc, id: string, toIndex: number): Doc {
  const from = clipIndexById(doc, id);
  if (from < 0) return doc;
  const to = Math.max(0, Math.min(doc.clips.length, Math.round(toIndex)));
  if (to === from || to === from + 1) return doc;
  const clips = [...doc.clips];
  const [clip] = clips.splice(from, 1);
  clips.splice(to > from ? to - 1 : to, 0, clip!);
  return normalize({ ...doc, clips });
}

/**
 * Ripple delete: later clips close the gap; transitions on both of its cuts go too.
 * Deleting the last clip leaves an empty timeline. Same reference for an unknown id.
 */
export function deleteClip(doc: Doc, id: string): Doc {
  if (clipIndexById(doc, id) < 0) return doc;
  return normalize({ ...doc, clips: doc.clips.filter((c) => c.id !== id) });
}

export type SplitResult =
  | { ok: true; doc: Doc; left: Clip; right: Clip }
  | { ok: false; reason: 'on-cut' | 'in-transition' | 'outside'; transition?: Transition };

/**
 * Blade at timeline frame t: the clip under t becomes two instances of the same
 * source, meeting at a new cut with full handles. The left part keeps the id;
 * a transition on the clip's outgoing cut moves to the right part.
 */
export function splitClip(doc: Doc, t: Frames): SplitResult {
  if (!Number.isInteger(t) || t <= 0 || t >= timelineLength(doc)) return { ok: false, reason: 'outside' };
  const i = clipIndexAt(doc, t);
  const clip = doc.clips[i]!;
  const start = clipStarts(doc)[i]!;
  const end = start + visibleLength(clip);
  if (t === start) return { ok: false, reason: 'on-cut' };

  const prev = doc.clips[i - 1];
  const next = doc.clips[i + 1];
  const before = prev ? transitionAt(doc, cutKeyOf(prev.id, clip.id)) : null;
  const after = next ? transitionAt(doc, cutKeyOf(clip.id, next.id)) : null;
  if (before && t < start + before.duration / 2) return { ok: false, reason: 'in-transition', transition: before };
  if (after && t > end - after.duration / 2) return { ok: false, reason: 'in-transition', transition: after };

  const at = clip.sourceIn + (t - start);
  const left: Clip = { ...clip, sourceOut: at };
  const right: Clip = { ...clip, id: `c${doc.nextId}`, sourceIn: at };
  const clips = [...doc.clips.slice(0, i), left, right, ...doc.clips.slice(i + 1)];
  const transitions = after
    ? doc.transitions.map((x) => (x === after ? { ...after, fromId: right.id } : x))
    : doc.transitions;
  return { ok: true, doc: normalize({ clips, transitions, nextId: doc.nextId + 1 }), left, right };
}

export type TrimEdge = 'start' | 'end';

/** Why a trim stopped short of the request. */
export type TrimLimit =
  | 'source-start'
  | 'source-end'
  /** A transition on this edge is down to its minimum and needs the remaining handle frame. */
  | 'edge-transition'
  /** The transition at the clip's other end needs the remaining length. */
  | 'other-transition'
  | 'min-length';

export interface TrimBounds {
  readonly min: Frames;
  readonly max: Frames;
  readonly minLimit: TrimLimit;
  readonly maxLimit: TrimLimit;
}

/**
 * Allowed values for the trimmed edge (sourceIn for 'start', sourceOut for
 * 'end'). Transitions on the trimmed edge shrink as the trim eats their room,
 * down to the minimum; the transition at the other end stays as it is.
 */
export function trimBounds(doc: Doc, id: string, edge: TrimEdge): TrimBounds | null {
  const i = clipIndexById(doc, id);
  if (i < 0) return null;
  const clip = doc.clips[i]!;
  const prev = doc.clips[i - 1];
  const next = doc.clips[i + 1];
  const before = prev ? transitionAt(doc, cutKeyOf(prev.id, clip.id)) : null;
  const after = next ? transitionAt(doc, cutKeyOf(clip.id, next.id)) : null;
  const MIN_HALF = 1;

  if (edge === 'start') {
    const edgeT = before;
    const otherHalf = after ? after.duration / 2 : 0;
    // Shortest allowed: the other transition's half, plus 1 frame for a shrunken edge transition (or 1 frame of clip).
    const keep = edgeT ? otherHalf + MIN_HALF : Math.max(1, otherHalf);
    const maxIn = clip.sourceOut - keep;
    const minIn = edgeT ? MIN_HALF : 0;
    return {
      min: minIn,
      max: Math.max(minIn, maxIn),
      minLimit: edgeT ? 'edge-transition' : 'source-start',
      maxLimit: after ? 'other-transition' : edgeT ? 'edge-transition' : 'min-length',
    };
  }
  const edgeT = after;
  const otherHalf = before ? before.duration / 2 : 0;
  const keep = edgeT ? otherHalf + MIN_HALF : Math.max(1, otherHalf);
  const minOut = clip.sourceIn + keep;
  const maxOut = clip.sourceFrames - (edgeT ? MIN_HALF : 0);
  return {
    min: Math.min(minOut, maxOut),
    max: maxOut,
    minLimit: before ? 'other-transition' : edgeT ? 'edge-transition' : 'min-length',
    maxLimit: edgeT ? 'edge-transition' : 'source-end',
  };
}

export interface TrimResult {
  readonly doc: Doc;
  /** Set when the request went past a bound. */
  readonly limit: TrimLimit | null;
}

/** Move one edge of a clip to source frame `requested`, clamped to trimBounds. Later clips shift. */
export function trimClip(doc: Doc, id: string, edge: TrimEdge, requested: Frames): TrimResult {
  const b = trimBounds(doc, id, edge);
  if (!b) return { doc, limit: null };
  const r = Math.round(requested);
  const value = Math.max(b.min, Math.min(b.max, r));
  const limit = r < b.min ? b.minLimit : r > b.max ? b.maxLimit : null;
  const i = clipIndexById(doc, id);
  const clip = doc.clips[i]!;
  const current = edge === 'start' ? clip.sourceIn : clip.sourceOut;
  if (value === current) return { doc, limit };
  const nextClip = edge === 'start' ? { ...clip, sourceIn: value } : { ...clip, sourceOut: value };
  const clips = doc.clips.map((c, k) => (k === i ? nextClip : c));
  return { doc: normalize({ ...doc, clips }), limit };
}

/** The transition that a trim limit refers to, for messages. */
export function trimLimitTransition(doc: Doc, id: string, edge: TrimEdge, limit: TrimLimit): Transition | null {
  const i = clipIndexById(doc, id);
  if (i < 0) return null;
  const clip = doc.clips[i]!;
  const prev = doc.clips[i - 1];
  const next = doc.clips[i + 1];
  const before = prev ? transitionAt(doc, cutKeyOf(prev.id, clip.id)) : null;
  const after = next ? transitionAt(doc, cutKeyOf(clip.id, next.id)) : null;
  if (limit === 'edge-transition') return edge === 'start' ? before : after;
  if (limit === 'other-transition') return edge === 'start' ? after : before;
  return null;
}

