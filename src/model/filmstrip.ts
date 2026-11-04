import type { Frames } from './time';

/** Thumbnail tiles fill the clip's height (72 px minus its 1 px border) at 16:9. */
export const STRIP_TILE_HEIGHT = 70;
export const STRIP_TILE_WIDTH = Math.round((STRIP_TILE_HEIGHT * 16) / 9);

export interface StripTile {
  /** Left edge in px from the clip's left edge. */
  readonly x: number;
  /** Source frame shown: the one at the tile's left edge. */
  readonly frame: Frames;
}

/**
 * Tiles laid left to right from the clip's in-point, enough to cover
 * `widthPx`; the last one is cropped by the clip. Each shows the source
 * frame under its left edge, so trimming the start slides the whole strip.
 */
export function stripTiles(
  sourceIn: Frames,
  sourceOut: Frames,
  widthPx: number,
  pxPerFrame: number,
  tileWidth = STRIP_TILE_WIDTH,
): StripTile[] {
  if (widthPx <= 0 || sourceOut <= sourceIn || pxPerFrame <= 0) return [];
  const n = Math.max(1, Math.ceil(widthPx / tileWidth));
  const last = sourceOut - 1;
  const out: StripTile[] = [];
  for (let i = 0; i < n; i++) {
    const x = i * tileWidth;
    out.push({ x, frame: Math.min(last, sourceIn + Math.floor(x / pxPerFrame)) });
  }
  return out;
}
