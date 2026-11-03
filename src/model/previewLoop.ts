import { clamp, type Frames } from './time';

/**
 * The preset preview loops a window of the timeline around the cut:
 * [cut − D/2 − leadIn, cut + D/2 + tail), then holds the last frame for
 * `hold` frames before starting over.
 */
export interface LoopRange {
  readonly start: Frames;
  /** Exclusive. */
  readonly end: Frames;
  readonly hold: Frames;
}

export function loopRange(
  cut: Frames,
  duration: Frames,
  leadIn: Frames,
  tail: Frames,
  hold: Frames,
  timelineLength: Frames,
): LoopRange {
  const half = duration / 2;
  const start = clamp(cut - half - leadIn, 0, Math.max(0, timelineLength - 1));
  const end = clamp(cut + half + tail, start + 1, timelineLength);
  return { start, end, hold: Math.max(0, hold) };
}

export const loopLength = (r: LoopRange): Frames => r.end - r.start;
export const cycleLength = (r: LoopRange): Frames => loopLength(r) + r.hold;

/** Timeline frame shown after `elapsed` whole frames of looping. */
export function loopFrameAt(r: LoopRange, elapsed: Frames): Frames {
  const cycle = cycleLength(r);
  const pos = ((Math.floor(elapsed) % cycle) + cycle) % cycle;
  return pos < loopLength(r) ? r.start + pos : r.end - 1;
}

/** Timeline frame for a single pass (reduced motion): stops on the last frame. */
export function onceFrameAt(r: LoopRange, elapsed: Frames): { frame: Frames; done: boolean } {
  const pos = Math.max(0, Math.floor(elapsed));
  if (pos >= loopLength(r) - 1) return { frame: r.end - 1, done: true };
  return { frame: r.start + pos, done: false };
}

/**
 * When the previewed preset changes mid-loop, keep showing the same timeline
 * frame (the same offset from the cut) so presets can be compared at the
 * same moment. Returns the elapsed count to continue the new loop from.
 * If that frame is outside the new window, the new loop starts from its beginning.
 */
export function rebaseElapsed(frame: Frames, next: LoopRange): Frames {
  if (frame >= next.start && frame < next.end) return frame - next.start;
  return 0;
}
