import type { Source } from './timeline';
import type { Frames } from './time';

/** Half-open source-frame range [start, end) to decode for one source. */
export interface DecodeRange {
  readonly sourceId: string;
  readonly start: Frames;
  readonly end: Frames;
}

export interface LibraryDecodeInput {
  readonly sources: readonly Pick<Source, 'id' | 'frames'>[];
  /** Source frame size in pixels (all library clips share it). */
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly capBytes: number;
  /** Smallest decode scale. Below the cap at this scale, everything is decoded anyway. */
  readonly minScale: number;
}

export interface LibraryDecodePlan {
  readonly ranges: readonly DecodeRange[];
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly frameCount: number;
  readonly bytes: number;
  /** True when even `minScale` exceeds the cap (all frames are kept anyway). */
  readonly overCap: boolean;
}

export const BYTES_PER_PIXEL = 4;

const evenDown = (n: number) => Math.max(2, 2 * Math.floor(n / 2));

export function frameBytes(width: number, height: number): number {
  return width * height * BYTES_PER_PIXEL;
}

export function scaledSize(w: number, h: number, scale: number) {
  return { width: evenDown(w * scale), height: evenDown(h * scale) };
}

/**
 * Every frame of every library source, at the largest size that fits the
 * memory cap. Timeline clips are windows onto these sources, so anything the
 * user builds (duplicates, splits, trims, transitions) plays from memory.
 * Bytes are estimated as width × height × 4.
 */
export function planLibraryDecode(input: LibraryDecodeInput): LibraryDecodePlan {
  const { sources, sourceWidth, sourceHeight, capBytes, minScale } = input;
  const ranges = sources.map((s) => ({ sourceId: s.id, start: 0, end: s.frames }));
  const frameCount = ranges.reduce((n, r) => n + (r.end - r.start), 0);

  const fits = (scale: number) => {
    const { width, height } = scaledSize(sourceWidth, sourceHeight, scale);
    return frameCount * frameBytes(width, height) <= capBytes;
  };
  const finish = (scale: number, overCap: boolean): LibraryDecodePlan => {
    const { width, height } = scaledSize(sourceWidth, sourceHeight, scale);
    return { ranges, width, height, scale, frameCount, bytes: frameCount * frameBytes(width, height), overCap };
  };

  if (frameCount === 0 || fits(1)) return finish(1, false);
  let scale = Math.min(1, Math.sqrt(capBytes / (frameCount * frameBytes(sourceWidth, sourceHeight))));
  while (scale > minScale && !fits(scale)) scale -= 0.005;
  if (scale >= minScale && fits(scale)) return finish(Math.round(scale * 1000) / 1000, false);
  return finish(minScale, true);
}

/** Every source frame in a range, ascending. */
export function framesInRange(r: DecodeRange): Frames[] {
  const out: Frames[] = [];
  for (let f = r.start; f < r.end; f++) out.push(f);
  return out;
}
