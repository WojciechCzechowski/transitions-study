/**
 * Pure helpers for drawing and hit-testing the timeline: magnetic insertion
 * points, ruler tick spacing and zoom.
 */
import { clipStarts, cuts, timelineLength, transitionAt, type Cut, type Doc } from './timeline';
import { FPS, type Frames } from './time';

/** Nearest clip boundary (0 … clips.length) to a timeline frame: where a drop or move lands. */
export function insertionIndex(doc: Doc, frame: number): number {
  const bounds = [...clipStarts(doc), timelineLength(doc)];
  let best = 0;
  for (let i = 1; i < bounds.length; i++) {
    if (Math.abs(bounds[i]! - frame) < Math.abs(bounds[best]! - frame)) best = i;
  }
  return best;
}

/**
 * The cut a preset drag at `frame` lands on: the nearest cut within `tolerance`
 * frames of the cut itself, or of the edges of a transition already on it.
 * Null when no cut is close enough. Dropping mid-clip never picks a far cut.
 */
export function cutAtFrame(doc: Doc, frame: number, tolerance: number): Cut | null {
  let best: Cut | null = null;
  let bestDist = Infinity;
  for (const cut of cuts(doc)) {
    const t = transitionAt(doc, cut.key);
    const reach = tolerance + (t ? t.duration / 2 : 0);
    const dist = Math.abs(frame - cut.frame);
    if (dist <= reach && dist < bestDist) {
      best = cut;
      bestDist = dist;
    }
  }
  return best;
}

/** Timeline frame of a clip boundary. */
export function boundaryFrame(doc: Doc, index: number): Frames {
  const starts = clipStarts(doc);
  return index >= starts.length ? timelineLength(doc) : starts[Math.max(0, index)]!;
}

const STEPS: readonly { major: Frames; minor: Frames }[] = [
  { major: 5, minor: 1 },
  { major: 10, minor: 2 },
  { major: 30, minor: 5 },
  { major: 60, minor: 10 },
  { major: 150, minor: 30 },
  { major: 300, minor: 60 },
  { major: 900, minor: 150 },
];

/** Ruler spacing: the smallest step whose labels are at least `minLabelPx` apart. */
export function tickStep(pxPerFrame: number, minLabelPx = 64): { major: Frames; minor: Frames } {
  for (const s of STEPS) if (s.major * pxPerFrame >= minLabelPx) return s;
  return STEPS[STEPS.length - 1]!;
}

/**
 * Ruler label in one format per zoom level: "0:05" when the major step is whole
 * seconds, "0:05:00" / "0:05:10" (with frames) on every label when it's finer.
 */
export function rulerLabel(f: Frames, majorStep: Frames): string {
  const total = Math.floor(f / FPS);
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, '0');
  return majorStep % FPS === 0 ? `${m}:${s}` : `${m}:${s}:${String(f % FPS).padStart(2, '0')}`;
}

export const ZOOM = { minPxPerFrame: 0.25, maxPxPerFrame: 24 } as const;

export const clampZoom = (ppf: number) => Math.min(ZOOM.maxPxPerFrame, Math.max(ZOOM.minPxPerFrame, ppf));

/** Scale that fits `length` frames into `width` px. */
export function fitScale(length: Frames, width: number): number {
  if (!(length > 0) || !(width > 0)) return 1;
  return clampZoom(width / length);
}

const LOG_MIN = Math.log(ZOOM.minPxPerFrame);
const LOG_MAX = Math.log(ZOOM.maxPxPerFrame);

/** Zoom slider position 0…100 (log scale) ↔ pixels per frame. */
export const zoomToSlider = (ppf: number) => Math.round((100 * (Math.log(clampZoom(ppf)) - LOG_MIN)) / (LOG_MAX - LOG_MIN));
export const sliderToZoom = (v: number) => clampZoom(Math.exp(LOG_MIN + (Math.min(100, Math.max(0, v)) / 100) * (LOG_MAX - LOG_MIN)));
