import { cutFrame, getLimits, type Doc } from './timeline';
import type { Frames } from './time';

/** Half-open source-frame range [start, end) to decode for one clip. */
export interface DecodeRange {
  readonly clipId: string;
  readonly start: Frames;
  readonly end: Frames;
}

export interface DecodePlanInput {
  readonly doc: Doc;
  /** Preview padding before the transition (clip A only). */
  readonly leadIn: Frames;
  /** Preview padding after the transition (clip B only). */
  readonly tail: Frames;
  /** Source frame size in pixels. */
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly capBytes: number;
  /** Smallest decode scale before the plan starts trimming frames. */
  readonly minScale: number;
}

export interface DecodePlan {
  readonly a: DecodeRange;
  readonly b: DecodeRange;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly frameCount: number;
  readonly bytes: number;
  /** True when some visible frames far from the cut were left out to respect the cap. */
  readonly trimmed: boolean;
  /** True when even the frames around the cut exceed the cap at minScale (they are kept anyway). */
  readonly overCap: boolean;
}

export const BYTES_PER_PIXEL = 4;

const len = (r: { start: number; end: number }) => Math.max(0, r.end - r.start);
const evenDown = (n: number) => Math.max(2, 2 * Math.floor(n / 2));

export function frameBytes(width: number, height: number): number {
  return width * height * BYTES_PER_PIXEL;
}

export function scaledSize(w: number, h: number, scale: number) {
  return { width: evenDown(w * scale), height: evenDown(h * scale) };
}

/**
 * Decide which source frames to pre-decode and at what size.
 *
 * Priority: (1) every frame the longest possible transition and its preview
 * loop can touch ("reach"), (2) the rest of both visible ranges. Bytes are
 * estimated as width × height × 4. If everything does not fit under the cap,
 * the decode size shrinks down to `minScale`; after that, visible frames
 * farthest from the cut are dropped. The reach is never dropped.
 */
export function planDecode(input: DecodePlanInput): DecodePlan {
  const { doc, leadIn, tail, sourceWidth, sourceHeight, capBytes, minScale } = input;
  const { a, b } = doc;
  const half = getLimits(doc).max / 2;
  const cut = cutFrame(doc);

  // Full set: both visible ranges plus the handle frames a max transition uses.
  const fullA = { start: a.sourceIn, end: a.sourceOut + half };
  const fullB = { start: b.sourceIn - half, end: b.sourceOut };

  // Reach: the preview loop window around the cut, mapped to each clip's source.
  const loopStart = Math.max(a.start, cut - half - leadIn);
  const loopEnd = Math.min(b.start + (b.sourceOut - b.sourceIn), cut + half + tail);
  const reachA = { start: Math.max(fullA.start, a.sourceIn + (loopStart - a.start)), end: fullA.end };
  const reachB = { start: fullB.start, end: Math.min(fullB.end, b.sourceIn + (loopEnd - b.start)) };

  const fullCount = len(fullA) + len(fullB);
  const reachCount = len(reachA) + len(reachB);

  const fits = (scale: number, count: number) => {
    const { width, height } = scaledSize(sourceWidth, sourceHeight, scale);
    return count * frameBytes(width, height) <= capBytes;
  };

  const finish = (scale: number, ra: typeof fullA, rb: typeof fullB, trimmed: boolean, overCap: boolean): DecodePlan => {
    const { width, height } = scaledSize(sourceWidth, sourceHeight, scale);
    const frameCount = len(ra) + len(rb);
    return {
      a: { clipId: a.id, ...ra },
      b: { clipId: b.id, ...rb },
      width,
      height,
      scale,
      frameCount,
      bytes: frameCount * frameBytes(width, height),
      trimmed,
      overCap,
    };
  };

  // 1. Everything at full size, or at the largest scale that fits.
  if (fits(1, fullCount)) return finish(1, fullA, fullB, false, false);
  let scale = Math.min(1, Math.sqrt(capBytes / (fullCount * frameBytes(sourceWidth, sourceHeight))));
  while (scale > minScale && !fits(scale, fullCount)) scale -= 0.005;
  if (scale >= minScale && fits(scale, fullCount)) {
    return finish(Math.round(scale * 1000) / 1000, fullA, fullB, false, false);
  }

  // 2. At minScale: keep the reach, then grow outward from it while budget remains.
  scale = minScale;
  const { width, height } = scaledSize(sourceWidth, sourceHeight, scale);
  const budget = Math.floor(capBytes / frameBytes(width, height));
  if (budget < reachCount) return finish(scale, reachA, reachB, true, true);

  const ra = { ...reachA };
  const rb = { ...reachB };
  let spare = budget - reachCount;
  while (spare > 0 && (ra.start > fullA.start || rb.end < fullB.end)) {
    if (ra.start > fullA.start) {
      ra.start--;
      spare--;
    }
    if (spare > 0 && rb.end < fullB.end) {
      rb.end++;
      spare--;
    }
  }
  const trimmed = ra.start > fullA.start || rb.end < fullB.end;
  return finish(scale, ra, rb, trimmed, false);
}

/** Every source frame in the plan for one clip, ascending. */
export function framesInRange(r: DecodeRange): Frames[] {
  const out: Frames[] = [];
  for (let f = r.start; f < r.end; f++) out.push(f);
  return out;
}
