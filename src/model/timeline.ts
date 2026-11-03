import { assertFrames, clamp, floorToEven, roundToEven, type Frames } from './time';

/** One clip on the single track. Source ranges are half-open: [sourceIn, sourceOut). */
export interface Clip {
  readonly id: string;
  readonly label: string;
  readonly file: string;
  /** Total frames available in the source file. */
  readonly sourceFrames: Frames;
  /** First visible source frame (inclusive). Frames before it are the head handle. */
  readonly sourceIn: Frames;
  /** One past the last visible source frame. Frames from here on are the tail handle. */
  readonly sourceOut: Frames;
  /** Timeline frame where sourceIn appears. */
  readonly start: Frames;
}

/**
 * A transition centred on the cut. Duration is always even so it spans
 * exactly duration/2 frames on each side. Easing and intensity are derived
 * from `feel` and the preset config at render time.
 */
export interface Transition {
  readonly id: string;
  readonly presetId: string;
  readonly duration: Frames;
  /** 0 = snappy … 100 = smooth. */
  readonly feel: number;
}

/** The undoable document: two adjacent clips and at most one transition at the cut. */
export interface Doc {
  readonly a: Clip;
  readonly b: Clip;
  readonly transition: Transition | null;
}

export const MIN_TRANSITION_DURATION: Frames = 2;

export const visibleLength = (c: Clip): Frames => c.sourceOut - c.sourceIn;
export const clipEnd = (c: Clip): Frames => c.start + visibleLength(c);
export const headHandle = (c: Clip): Frames => c.sourceIn;
export const tailHandle = (c: Clip): Frames => c.sourceFrames - c.sourceOut;

/** Timeline frame of the cut: the first frame of clip B. */
export const cutFrame = (doc: Doc): Frames => doc.b.start;
export const timelineLength = (doc: Doc): Frames => clipEnd(doc.b);

// ---------------------------------------------------------------------------
// Building a document

export interface ClipSourceInfo {
  readonly id: string;
  readonly label: string;
  readonly file: string;
  readonly frames: Frames;
}

export interface ClipLayout {
  /** Frames of head handle before the visible range (= sourceIn). */
  readonly head: Frames;
  /** Visible frames on the timeline. */
  readonly visible: Frames;
}

export type CreateDocResult =
  | { ok: true; doc: Doc }
  | { ok: false; error: 'source-too-short'; clip: ClipSourceInfo; needed: Frames; available: Frames };

/** Lay two sources out back to back, starting at timeline frame 0. */
export function createDoc(
  sources: readonly [ClipSourceInfo, ClipSourceInfo],
  layout: readonly [ClipLayout, ClipLayout],
): CreateDocResult {
  const clips: Clip[] = [];
  let start = 0;
  for (let i = 0; i < 2; i++) {
    const src = sources[i]!;
    const lay = layout[i]!;
    assertFrames(lay.head, 'head');
    assertFrames(lay.visible, 'visible');
    const needed = lay.head + lay.visible;
    if (needed > src.frames || lay.visible < 1 || lay.head < 0) {
      return { ok: false, error: 'source-too-short', clip: src, needed, available: src.frames };
    }
    clips.push({
      id: src.id,
      label: src.label,
      file: src.file,
      sourceFrames: src.frames,
      sourceIn: lay.head,
      sourceOut: lay.head + lay.visible,
      start,
    });
    start += lay.visible;
  }
  return { ok: true, doc: { a: clips[0]!, b: clips[1]!, transition: null } };
}

// ---------------------------------------------------------------------------
// Duration limits

/** What caps the maximum duration. Handles are listed first so they win ties. */
export type LimitSource = 'a-tail' | 'b-head' | 'a-length' | 'b-length';

export interface Limits {
  readonly min: Frames;
  /** Largest even duration that fits; 0 when no centred transition is possible. */
  readonly max: Frames;
  readonly canTransition: boolean;
  readonly limitedBy: LimitSource;
  /** Frames available on each side of the cut, per constraint. */
  readonly available: {
    readonly aTail: Frames;
    readonly bHead: Frames;
    readonly aLength: Frames;
    readonly bLength: Frames;
  };
}

/**
 * A centred transition of duration D needs D/2 frames of clip A's tail handle
 * (A keeps playing past its out point) and D/2 frames of clip B's head handle
 * (B starts before its in point). It also cannot reach past either clip's
 * visible start/end.
 */
export function getLimits(doc: Doc): Limits {
  const available = {
    aTail: tailHandle(doc.a),
    bHead: headHandle(doc.b),
    aLength: visibleLength(doc.a),
    bLength: visibleLength(doc.b),
  };
  const candidates: [LimitSource, Frames][] = [
    ['a-tail', available.aTail],
    ['b-head', available.bHead],
    ['a-length', available.aLength],
    ['b-length', available.bLength],
  ];
  let limitedBy: LimitSource = 'a-tail';
  let half = Infinity;
  for (const [source, frames] of candidates) {
    if (frames < half) {
      half = frames;
      limitedBy = source;
    }
  }
  const max = floorToEven(Math.max(0, half) * 2);
  return {
    min: MIN_TRANSITION_DURATION,
    max: max >= MIN_TRANSITION_DURATION ? max : 0,
    canTransition: max >= MIN_TRANSITION_DURATION,
    limitedBy,
    available,
  };
}

export interface ClampResult {
  readonly duration: Frames;
  /** Which bound stopped the request, if any. */
  readonly clamped: 'min' | 'max' | null;
}

/** Round a requested duration to even and clamp it into the limits. */
export function clampDuration(requested: number, limits: Limits): ClampResult {
  if (!limits.canTransition) return { duration: 0, clamped: 'max' };
  const even = roundToEven(requested);
  if (even > limits.max) return { duration: limits.max, clamped: 'max' };
  if (even < limits.min) return { duration: limits.min, clamped: 'min' };
  return { duration: even, clamped: null };
}

// ---------------------------------------------------------------------------
// Resolving what to show at a timeline frame

export interface FrameRef {
  readonly clipId: string;
  /** Source frame index within the clip's file. */
  readonly frame: Frames;
}

export type Resolved =
  | { readonly kind: 'single'; readonly t: Frames; readonly source: FrameRef }
  | {
      readonly kind: 'transition';
      readonly t: Frames;
      readonly from: FrameRef;
      readonly to: FrameRef;
      /** 0…1, sampled at frame centres so it is symmetric around the cut. */
      readonly linear: number;
      readonly presetId: string;
      readonly feel: number;
    };

export interface TransitionRange {
  readonly start: Frames;
  readonly end: Frames;
}

export function transitionRange(doc: Doc, transition = doc.transition): TransitionRange | null {
  if (!transition) return null;
  const cut = cutFrame(doc);
  const half = transition.duration / 2;
  return { start: cut - half, end: cut + half };
}

/** Map a timeline frame to source frames. t is clamped into the timeline. */
export function resolveFrame(doc: Doc, t: Frames, transition = doc.transition): Resolved {
  const len = timelineLength(doc);
  const tt = clamp(Math.round(t), 0, Math.max(0, len - 1));
  const range = transitionRange(doc, transition);
  const sourceIn = (c: Clip): FrameRef => ({ clipId: c.id, frame: c.sourceIn + (tt - c.start) });
  if (transition && range && tt >= range.start && tt < range.end) {
    return {
      kind: 'transition',
      t: tt,
      from: sourceIn(doc.a),
      to: sourceIn(doc.b),
      linear: (tt - range.start + 0.5) / transition.duration,
      presetId: transition.presetId,
      feel: transition.feel,
    };
  }
  return { kind: 'single', t: tt, source: sourceIn(tt < cutFrame(doc) ? doc.a : doc.b) };
}

// ---------------------------------------------------------------------------

/** Value equality for documents, used so a drag that ends where it began is not an undo step. */
export function docEquals(x: Doc, y: Doc): boolean {
  if (x === y) return true;
  if (x.a !== y.a || x.b !== y.b) return false;
  const p = x.transition;
  const q = y.transition;
  if (p === q) return true;
  if (!p || !q) return false;
  return p.id === q.id && p.presetId === q.presetId && p.duration === q.duration && p.feel === q.feel;
}
