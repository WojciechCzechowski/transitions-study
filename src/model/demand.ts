import type { LoopRange } from './previewLoop';
import { resolveFrame, timelineLength, type Doc, type FrameRef, type TransitionOverride } from './timeline';
import type { Frames } from './time';

/** What the preview is doing, as far as frame demand is concerned. */
export type DemandMode =
  | { readonly kind: 'idle'; readonly playhead: Frames }
  | { readonly kind: 'playing'; readonly playhead: Frames }
  | { readonly kind: 'preview'; readonly frame: Frames; readonly range: LoopRange; readonly override?: TransitionOverride };

export interface DemandOptions {
  /** Timeline frames ahead of the playhead to have ready while playing. */
  readonly lookahead: Frames;
  /** Timeline frames around a still playhead (scrubbing, frame stepping). */
  readonly scrubAhead: Frames;
  readonly scrubBehind: Frames;
  /** Most source frames to ask for (the cache budget). */
  readonly maxFrames: number;
}

export const frameRefKey = (r: FrameRef) => `${r.sourceId}:${r.frame}`;

/** Timeline frames in the order they are needed. */
function timelineOrder(len: Frames, mode: DemandMode, o: DemandOptions): Frames[] {
  const out: Frames[] = [];
  const push = (t: Frames) => {
    if (t >= 0 && t < len) out.push(t);
  };
  if (mode.kind === 'idle') {
    push(mode.playhead);
    for (let i = 1; i <= o.scrubAhead; i++) push(mode.playhead + i);
    for (let i = 1; i <= o.scrubBehind; i++) push(mode.playhead - i);
  } else if (mode.kind === 'playing') {
    for (let i = 0; i <= o.lookahead; i++) push(mode.playhead + i);
  } else {
    const { start, end } = mode.range;
    const at = Math.min(Math.max(mode.frame, start), end - 1);
    for (let t = at; t < end; t++) push(t);
    for (let t = start; t < at; t++) push(t);
  }
  return out;
}

/**
 * Source frames the preview needs, most urgent first, without duplicates,
 * cut off at the cache budget. A frame inside a transition needs both sides.
 */
export function wantedFrames(doc: Doc, mode: DemandMode, o: DemandOptions): FrameRef[] {
  const len = timelineLength(doc);
  if (len <= 0 || o.maxFrames <= 0) return [];
  const override = mode.kind === 'preview' ? mode.override : undefined;
  const seen = new Set<string>();
  const out: FrameRef[] = [];
  const add = (r: FrameRef) => {
    const k = frameRefKey(r);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(r);
  };
  for (const t of timelineOrder(len, mode, o)) {
    const r = resolveFrame(doc, t, override);
    if (r.kind === 'single') add(r.source);
    else {
      add(r.from);
      add(r.to);
    }
    if (out.length >= o.maxFrames) return out.slice(0, o.maxFrames);
  }
  return out;
}
