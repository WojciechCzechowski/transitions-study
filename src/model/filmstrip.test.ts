import { describe, expect, it } from 'vitest';
import { stripTiles } from './filmstrip';

describe('stripTiles', () => {
  it('covers the clip from its in-point, one tile per tile width', () => {
    // 60 frames at 4 px/frame = 240 px; tiles 100 px wide → 3 tiles, the last cropped.
    expect(stripTiles(15, 75, 240, 4, 100)).toEqual([
      { x: 0, frame: 15 },
      { x: 100, frame: 40 },
      { x: 200, frame: 65 },
    ]);
  });

  it('never shows a frame past the out-point', () => {
    const tiles = stripTiles(0, 10, 500, 50, 100);
    expect(tiles.map((t) => t.frame)).toEqual([0, 2, 4, 6, 8]);
    expect(stripTiles(0, 3, 300, 1, 100).map((t) => t.frame)).toEqual([0, 2, 2]);
  });

  it('gives a narrow clip one tile and an empty clip none', () => {
    expect(stripTiles(5, 6, 3, 3, 100)).toEqual([{ x: 0, frame: 5 }]);
    expect(stripTiles(5, 5, 0, 3, 100)).toEqual([]);
  });
});
