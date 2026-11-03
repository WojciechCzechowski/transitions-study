import { clampDuration, type ClampResult, type Limits } from './timeline';
import type { Frames } from './time';

export type Edge = 'left' | 'right';

/** Pointer travel in pixels → whole frames. */
export function pxToFrames(dxPx: number, pxPerFrame: number): Frames {
  if (!(pxPerFrame > 0)) return 0;
  const f = Math.round(dxPx / pxPerFrame);
  return Object.is(f, -0) ? 0 : f;
}

/**
 * Dragging either edge resizes symmetrically: moving the right edge right by
 * n frames (or the left edge left by n) grows each side by n, so the
 * duration grows by 2n and the transition stays centred on the cut.
 */
export function requestedFromDrag(startDuration: Frames, edge: Edge, deltaFrames: Frames): Frames {
  const outward = edge === 'right' ? deltaFrames : -deltaFrames;
  return startDuration + 2 * outward;
}

export interface DragResult extends ClampResult {
  readonly requested: Frames;
}

export function dragDuration(
  startDuration: Frames,
  edge: Edge,
  dxPx: number,
  pxPerFrame: number,
  limits: Limits,
): DragResult {
  const requested = requestedFromDrag(startDuration, edge, pxToFrames(dxPx, pxPerFrame));
  return { ...clampDuration(requested, limits), requested };
}
