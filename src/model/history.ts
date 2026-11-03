/**
 * Linear undo history with gestures. A gesture (e.g. a whole edge drag) can
 * update `present` many times and still produce exactly one undo step.
 */
export interface HistoryEntry<T> {
  readonly state: T;
  /** The action that moves from this entry to its neighbour, e.g. "Change duration". */
  readonly label: string;
}

export interface History<T> {
  /** Older states, oldest first. Each label names the action that left that state. */
  readonly past: readonly HistoryEntry<T>[];
  readonly present: T;
  /** Redo targets, nearest first. Each label names the action that produces that state. */
  readonly future: readonly HistoryEntry<T>[];
  /** Set while a gesture is in progress; `base` is the state before it began. */
  readonly gesture: { readonly base: T } | null;
}

export type Equals<T> = (a: T, b: T) => boolean;

export const HISTORY_LIMIT = 200;

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [], gesture: null };
}

function pushPast<T>(past: readonly HistoryEntry<T>[], entry: HistoryEntry<T>, limit: number) {
  const next = [...past, entry];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

/** Record a discrete change. No-ops are dropped; any redo branch is discarded. */
export function commit<T>(
  h: History<T>,
  next: T,
  label: string,
  equals: Equals<T> = Object.is,
  limit = HISTORY_LIMIT,
): History<T> {
  const settled = h.gesture ? endGesture(h, label, equals, limit) : h;
  if (equals(settled.present, next)) return settled;
  return {
    past: pushPast(settled.past, { state: settled.present, label }, limit),
    present: next,
    future: [],
    gesture: null,
  };
}

export const canUndo = <T>(h: History<T>) => !h.gesture && h.past.length > 0;
export const canRedo = <T>(h: History<T>) => !h.gesture && h.future.length > 0;
export const undoLabel = <T>(h: History<T>) => h.past[h.past.length - 1]?.label ?? null;
export const redoLabel = <T>(h: History<T>) => h.future[0]?.label ?? null;

/** Step back. Ignored mid-gesture. */
export function undo<T>(h: History<T>): History<T> {
  if (!canUndo(h)) return h;
  const top = h.past[h.past.length - 1]!;
  return {
    past: h.past.slice(0, -1),
    present: top.state,
    future: [{ state: h.present, label: top.label }, ...h.future],
    gesture: null,
  };
}

/** Step forward. Ignored mid-gesture. */
export function redo<T>(h: History<T>): History<T> {
  if (!canRedo(h)) return h;
  const [next, ...rest] = h.future as [HistoryEntry<T>, ...HistoryEntry<T>[]];
  return {
    past: [...h.past, { state: h.present, label: next.label }],
    present: next.state,
    future: rest,
    gesture: null,
  };
}

export function beginGesture<T>(h: History<T>): History<T> {
  if (h.gesture) return h;
  return { ...h, gesture: { base: h.present } };
}

/** Replace `present` during a gesture without recording a step. */
export function updateGesture<T>(h: History<T>, next: T): History<T> {
  if (!h.gesture || Object.is(h.present, next)) return h;
  return { ...h, present: next };
}

/** Finish a gesture as one step, or as nothing if it ended where it began. */
export function endGesture<T>(
  h: History<T>,
  label: string,
  equals: Equals<T> = Object.is,
  limit = HISTORY_LIMIT,
): History<T> {
  if (!h.gesture) return h;
  const { base } = h.gesture;
  if (equals(base, h.present)) return { ...h, present: base, gesture: null };
  return {
    past: pushPast(h.past, { state: base, label }, limit),
    present: h.present,
    future: [],
    gesture: null,
  };
}

/** Abandon a gesture and restore the state from before it. */
export function cancelGesture<T>(h: History<T>): History<T> {
  if (!h.gesture) return h;
  return { ...h, present: h.gesture.base, gesture: null };
}
