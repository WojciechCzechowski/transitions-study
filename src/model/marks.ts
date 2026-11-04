import { insertRange, type InsertHandles, type SourceRange } from './ops';
import type { Frames } from './time';

/** In and out marks on a Library clip, both inclusive source frames. Either may be unset. */
export interface Marks {
  readonly in?: Frames;
  readonly out?: Frames;
}

export const NO_MARKS: Marks = {};

export const hasMarks = (m: Marks | undefined): boolean => m?.in !== undefined || m?.out !== undefined;

/** Mark in at `frame`. An out mark before it no longer makes sense and is cleared. */
export function markIn(m: Marks, frame: Frames): Marks {
  return m.out !== undefined && m.out < frame ? { in: frame } : { ...m, in: frame };
}

/** Mark out at `frame`. An in mark after it no longer makes sense and is cleared. */
export function markOut(m: Marks, frame: Frames): Marks {
  return m.in !== undefined && m.in > frame ? { out: frame } : { ...m, out: frame };
}

/**
 * The part of a source a Library clip adds to the timeline. Without marks it
 * is the default (handles left on both sides, so its cuts take transitions).
 * With only an in mark it runs to the end; with only an out mark it starts at
 * the beginning.
 */
export function markedRange(frames: Frames, m: Marks | undefined, handles: InsertHandles): SourceRange {
  if (!m || !hasMarks(m)) return insertRange(frames, handles);
  const last = Math.max(0, frames - 1);
  const start = Math.max(0, Math.min(last, m.in ?? 0));
  const end = Math.max(start, Math.min(last, m.out ?? last));
  return { sourceIn: start, sourceOut: end + 1 };
}
