import type { Bezier } from './easing';
import { assertFrames, clamp, floorToEven, roundToEven, type Frames } from './time';

/** A library item: one prepared clip file. */
export interface Source {
  readonly id: string;
  readonly label: string;
  readonly file: string;
  /** Total frames in the file. */
  readonly frames: Frames;
}

/**
 * One clip instance on the magnetic V1 track: a window onto a source.
 * Source ranges are half-open: [sourceIn, sourceOut). Its timeline position is
 * derived from the clips before it (no gaps).
 */
export interface Clip {
  readonly id: string;
  readonly sourceId: string;
  readonly label: string;
  readonly file: string;
  /** Total frames available in the source file. */
  readonly sourceFrames: Frames;
  /** First visible source frame (inclusive). Frames before it are the head handle. */
  readonly sourceIn: Frames;
  /** One past the last visible source frame. Frames from here on are the tail handle. */
  readonly sourceOut: Frames;
}

/**
 * A transition centred on the cut between clips `fromId` and `toId`. Duration
 * is always even so it spans exactly duration/2 frames on each side. Easing and
 * intensity are derived from `feel` and the preset config at render time, unless
 * Fine-tune set them directly.
 */
export interface Transition {
  readonly id: string;
  readonly fromId: string;
  readonly toId: string;
  readonly presetId: string;
  readonly duration: Frames;
  /** 0 = snappy … 100 = smooth. */
  readonly feel: number;
  /** Fine-tune: a curve that replaces the one from Feel. */
  readonly easing?: Bezier;
  /** Fine-tune: an intensity that replaces the one from Feel. */
  readonly intensity?: number;
}

/** The undoable document: clips back to back, and at most one transition per cut. */
export interface Doc {
  readonly clips: readonly Clip[];
  readonly transitions: readonly Transition[];
  /** Counter for new clip and transition ids, so undo/redo stays deterministic. */
  readonly nextId: number;
}

/** The join between two adjacent clips. */
export interface Cut {
  /** Stable while the same two clips stay adjacent. */
  readonly key: string;
  /** Index of the outgoing clip. */
  readonly index: number;
  /** Timeline frame of the cut: the first frame of `to`. */
  readonly frame: Frames;
  readonly from: Clip;
  readonly to: Clip;
}

export const MIN_TRANSITION_DURATION: Frames = 2;

export const visibleLength = (c: Clip): Frames => c.sourceOut - c.sourceIn;
export const headHandle = (c: Clip): Frames => c.sourceIn;
export const tailHandle = (c: Clip): Frames => c.sourceFrames - c.sourceOut;
export const cutKeyOf = (fromId: string, toId: string) => `${fromId}|${toId}`;
export const transitionCutKey = (t: Transition) => cutKeyOf(t.fromId, t.toId);

/** Timeline start frame of every clip. */
export function clipStarts(doc: Doc): Frames[] {
  const out: Frames[] = [];
  let at = 0;
  for (const c of doc.clips) {
    out.push(at);
    at += visibleLength(c);
  }
  return out;
}

export function timelineLength(doc: Doc): Frames {
  let len = 0;
  for (const c of doc.clips) len += visibleLength(c);
  return len;
}

export function clipIndexById(doc: Doc, id: string): number {
  return doc.clips.findIndex((c) => c.id === id);
}

/** Index of the clip showing at timeline frame t (clamped into the timeline). */
export function clipIndexAt(doc: Doc, t: Frames): number {
  let at = 0;
  for (let i = 0; i < doc.clips.length; i++) {
    at += visibleLength(doc.clips[i]!);
    if (t < at) return i;
  }
  return doc.clips.length - 1;
}

export function cuts(doc: Doc): Cut[] {
  const out: Cut[] = [];
  let at = 0;
  for (let i = 0; i < doc.clips.length - 1; i++) {
    const from = doc.clips[i]!;
    const to = doc.clips[i + 1]!;
    at += visibleLength(from);
    out.push({ key: cutKeyOf(from.id, to.id), index: i, frame: at, from, to });
  }
  return out;
}

export function cutByKey(doc: Doc, key: string | null | undefined): Cut | null {
  if (!key) return null;
  return cuts(doc).find((c) => c.key === key) ?? null;
}

export function transitionAt(doc: Doc, cutKey: string): Transition | null {
  return doc.transitions.find((t) => transitionCutKey(t) === cutKey) ?? null;
}

export function transitionById(doc: Doc, id: string | null | undefined): Transition | null {
  if (!id) return null;
  return doc.transitions.find((t) => t.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// Building the starting document

export interface ClipLayout {
  /** Frames of head handle before the visible range (= sourceIn). */
  readonly head: Frames;
  /** Visible frames on the timeline. */
  readonly visible: Frames;
}

export type CreateDocResult =
  | { ok: true; doc: Doc }
  | { ok: false; error: 'source-too-short'; clip: Source; needed: Frames; available: Frames };

export function clipFromSource(src: Source, id: string, sourceIn: Frames, sourceOut: Frames): Clip {
  return { id, sourceId: src.id, label: src.label, file: src.file, sourceFrames: src.frames, sourceIn, sourceOut };
}

/** Lay sources out back to back with the given handles (the starting timeline). */
export function createDoc(sources: readonly Source[], layout: readonly ClipLayout[]): CreateDocResult {
  const clips: Clip[] = [];
  for (let i = 0; i < layout.length; i++) {
    const src = sources[i]!;
    const lay = layout[i]!;
    assertFrames(lay.head, 'head');
    assertFrames(lay.visible, 'visible');
    const needed = lay.head + lay.visible;
    if (needed > src.frames || lay.visible < 1 || lay.head < 0) {
      return { ok: false, error: 'source-too-short', clip: src, needed, available: src.frames };
    }
    clips.push(clipFromSource(src, `c${i + 1}`, lay.head, lay.head + lay.visible));
  }
  return { ok: true, doc: { clips, transitions: [], nextId: clips.length + 1 } };
}

// ---------------------------------------------------------------------------
// Duration limits

/** What caps the maximum duration: how much each clip can give once it is trimmed to make room. */
export type LimitSource = 'a-length' | 'b-length';

export interface Limits {
  readonly min: Frames;
  /**
   * Largest even duration reachable, trimming the clips at the cut to make
   * room when their handles are short; 0 when no centred transition is possible.
   */
  readonly max: Frames;
  readonly canTransition: boolean;
  readonly limitedBy: LimitSource;
  /** Largest even duration that fits the current handles without trimming (may be 0). */
  readonly fit: Frames;
  /** Frames available on each side of the cut, per constraint. */
  readonly available: {
    readonly aTail: Frames;
    readonly bHead: Frames;
    /** Outgoing clip length not used by a transition at its other end. */
    readonly aLength: Frames;
    /** Incoming clip length not used by a transition at its other end. */
    readonly bLength: Frames;
  };
}

const halfOf = (t: Transition | null) => (t ? t.duration / 2 : 0);

/**
 * Half-width one side can give: `handle` frames already past the edit point,
 * plus visible frames trimmed off to become handle. Trimming x frames turns x
 * of length into handle, so the half h needs h ≤ length − max(0, h − handle).
 */
const reachHalf = (handle: Frames, length: Frames): Frames =>
  Math.max(0, Math.min(length, Math.floor((length + handle) / 2)));

/**
 * A centred transition of duration D needs D/2 frames of the outgoing clip's
 * tail handle and D/2 frames of the incoming clip's head handle. It also cannot
 * reach past either clip's visible range, which it shares with a transition at
 * that clip's other end (two transitions never overlap inside one clip).
 * When a handle is short, the clip is trimmed to make one (see `roomFor`), so
 * the ceiling (`max`) is set by clip length; `fit` is what fits untrimmed.
 */
export function getLimits(doc: Doc, cut: Cut): Limits {
  const before = cut.index > 0 ? transitionAt(doc, cutKeyOf(doc.clips[cut.index - 1]!.id, cut.from.id)) : null;
  const next = doc.clips[cut.index + 2];
  const after = next ? transitionAt(doc, cutKeyOf(cut.to.id, next.id)) : null;
  const available = {
    aTail: tailHandle(cut.from),
    bHead: headHandle(cut.to),
    aLength: visibleLength(cut.from) - halfOf(before),
    bLength: visibleLength(cut.to) - halfOf(after),
  };
  const fitHalf = Math.min(available.aTail, available.bHead, available.aLength, available.bLength);
  const fit = floorToEven(Math.max(0, fitHalf) * 2);
  const aHalf = reachHalf(available.aTail, available.aLength);
  const bHalf = reachHalf(available.bHead, available.bLength);
  const max = floorToEven(Math.min(aHalf, bHalf) * 2);
  const ok = max >= MIN_TRANSITION_DURATION;
  return {
    min: MIN_TRANSITION_DURATION,
    max: ok ? max : 0,
    canTransition: ok,
    limitedBy: aHalf <= bHalf ? 'a-length' : 'b-length',
    fit: fit >= MIN_TRANSITION_DURATION ? fit : 0,
    available,
  };
}

/** Frames to trim off each clip at the cut so a centred transition of `duration` has its handles. */
export interface Room {
  /** Off the outgoing clip's end. */
  readonly a: Frames;
  /** Off the incoming clip's start. */
  readonly b: Frames;
}

export const NO_ROOM: Room = { a: 0, b: 0 };

export function roomFor(cut: Cut, duration: Frames): Room {
  const half = Math.max(0, duration / 2);
  const a = Math.max(0, half - tailHandle(cut.from));
  const b = Math.max(0, half - headHandle(cut.to));
  return a === 0 && b === 0 ? NO_ROOM : { a, b };
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

/**
 * Bring transitions back in line with the clips: drop any whose two clips are
 * no longer adjacent (or that no longer fit at all), and shrink the rest to
 * what their current handles hold (`fit`; normalize never trims clips).
 * Returns the same reference when nothing changed.
 */
export function normalize(doc: Doc): Doc {
  const order = new Map(cuts(doc).map((c) => [c.key, c] as const));
  const seen = new Set<string>();
  let kept = doc.transitions.filter((t) => {
    const key = transitionCutKey(t);
    if (!order.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  let changed = kept.length !== doc.transitions.length;
  // Clamp in timeline order, so each sees its already-clamped neighbour.
  kept = [...kept].sort((p, q) => order.get(transitionCutKey(p))!.index - order.get(transitionCutKey(q))!.index);
  if (!changed) changed = kept.some((t, i) => t !== doc.transitions[i]);
  let working: Doc = changed ? { ...doc, transitions: kept } : doc;
  for (const t of kept) {
    const cut = order.get(transitionCutKey(t))!;
    const limits = getLimits(working, cut);
    const list = working.transitions;
    if (limits.fit === 0) {
      working = { ...working, transitions: list.filter((x) => x !== t) };
    } else if (t.duration > limits.fit) {
      const next = { ...t, duration: limits.fit };
      working = { ...working, transitions: list.map((x) => (x === t ? next : x)) };
    }
  }
  return working;
}

// ---------------------------------------------------------------------------
// Resolving what to show at a timeline frame

export interface FrameRef {
  readonly sourceId: string;
  /** Source frame index within the file. */
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
      /** The transition (or preview) drawn here: preset, Feel and any Fine-tune overrides. */
      readonly look: TransitionLook;
    };

export interface TransitionRange {
  readonly start: Frames;
  readonly end: Frames;
}

export function transitionRange(cut: Cut, duration: Frames): TransitionRange {
  const half = duration / 2;
  return { start: cut.frame - half, end: cut.frame + half };
}

/** A transition shape without clip ids, e.g. a preset being previewed. */
export interface TransitionLook {
  readonly presetId: string;
  readonly duration: Frames;
  readonly feel: number;
  readonly easing?: Bezier;
  readonly intensity?: number;
}

/** Replace (or add, or hide with null) the transition at one cut, for previews. */
export interface TransitionOverride {
  readonly cutKey: string;
  readonly look: TransitionLook | null;
}

/** Map a timeline frame to source frames. t is clamped into the timeline. */
export function resolveFrame(doc: Doc, t: Frames, override?: TransitionOverride): Resolved {
  const len = timelineLength(doc);
  const tt = clamp(Math.round(t), 0, Math.max(0, len - 1));
  const i = clipIndexAt(doc, tt);
  const starts = clipStarts(doc);
  const clip = doc.clips[i]!;
  const start = starts[i]!;
  const end = start + visibleLength(clip);
  const at = (c: Clip, cStart: Frames): FrameRef => ({ sourceId: c.sourceId, frame: c.sourceIn + (tt - cStart) });

  const lookAt = (key: string): TransitionLook | null => {
    if (override && override.cutKey === key) return override.look;
    return transitionAt(doc, key);
  };

  const prev = doc.clips[i - 1];
  if (prev) {
    const look = lookAt(cutKeyOf(prev.id, clip.id));
    if (look && tt < start + look.duration / 2) {
      return {
        kind: 'transition',
        t: tt,
        from: at(prev, starts[i - 1]!),
        to: at(clip, start),
        linear: (tt - (start - look.duration / 2) + 0.5) / look.duration,
        presetId: look.presetId,
        look,
      };
    }
  }
  const next = doc.clips[i + 1];
  if (next) {
    const look = lookAt(cutKeyOf(clip.id, next.id));
    if (look && tt >= end - look.duration / 2) {
      return {
        kind: 'transition',
        t: tt,
        from: at(clip, start),
        to: at(next, end),
        linear: (tt - (end - look.duration / 2) + 0.5) / look.duration,
        presetId: look.presetId,
        look,
      };
    }
  }
  return { kind: 'single', t: tt, source: at(clip, start) };
}

// ---------------------------------------------------------------------------

const sameBezier = (a: Bezier | undefined, b: Bezier | undefined) =>
  a === b || (!!a && !!b && a.every((v, i) => v === b[i]));

const sameTransition = (p: Transition, q: Transition) =>
  p === q ||
  (p.id === q.id &&
    p.fromId === q.fromId &&
    p.toId === q.toId &&
    p.presetId === q.presetId &&
    p.duration === q.duration &&
    p.feel === q.feel &&
    p.intensity === q.intensity &&
    sameBezier(p.easing, q.easing));

/** Value equality for documents, used so a drag that ends where it began is not an undo step. */
export function docEquals(x: Doc, y: Doc): boolean {
  if (x === y) return true;
  if (x.nextId !== y.nextId) return false;
  if (x.clips.length !== y.clips.length || x.transitions.length !== y.transitions.length) return false;
  for (let i = 0; i < x.clips.length; i++) {
    const p = x.clips[i]!;
    const q = y.clips[i]!;
    if (p !== q && (p.id !== q.id || p.sourceIn !== q.sourceIn || p.sourceOut !== q.sourceOut || p.sourceId !== q.sourceId)) {
      return false;
    }
  }
  for (let i = 0; i < x.transitions.length; i++) {
    if (!sameTransition(x.transitions[i]!, y.transitions[i]!)) return false;
  }
  return true;
}
