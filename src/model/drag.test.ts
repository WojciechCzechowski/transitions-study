import { describe, expect, it } from 'vitest';
import { dragDuration, pxToFrames, requestedFromDrag } from './dragDuration';
import { generous, shortB } from './fixtures';
import { getLimits } from './timeline';

describe('edge drag → duration', () => {
  it('grows symmetrically: each frame of edge travel adds one frame per side', () => {
    expect(requestedFromDrag(24, 'right', 3)).toBe(30);
    expect(requestedFromDrag(24, 'left', -3)).toBe(30);
  });

  it('shrinks when either edge moves inward', () => {
    expect(requestedFromDrag(24, 'right', -4)).toBe(16);
    expect(requestedFromDrag(24, 'left', 4)).toBe(16);
  });

  it('treats the two edges as mirror images', () => {
    for (const d of [-10, -1, 0, 1, 7]) {
      expect(requestedFromDrag(20, 'right', d)).toBe(requestedFromDrag(20, 'left', -d));
    }
  });

  it('rounds pixel travel to whole frames', () => {
    expect(pxToFrames(11, 7.5)).toBe(1);
    expect(pxToFrames(-3, 7.5)).toBe(0);
    expect(pxToFrames(-4, 7.5)).toBe(-1);
    expect(pxToFrames(10, 0)).toBe(0);
  });

  it('stops at the handle limit and reports the clamp', () => {
    const limits = getLimits(shortB()); // max 36
    const r = dragDuration(24, 'right', 200, 7.5, limits);
    expect(r).toMatchObject({ duration: 36, clamped: 'max' });
    expect(r.requested).toBeGreaterThan(36);
  });

  it('stops at the minimum', () => {
    const r = dragDuration(24, 'left', 500, 7.5, getLimits(generous()));
    expect(r).toMatchObject({ duration: 2, clamped: 'min' });
  });

  it('is unclamped inside the limits', () => {
    const r = dragDuration(24, 'right', 15, 7.5, getLimits(generous()));
    expect(r).toEqual({ duration: 28, clamped: null, requested: 28 });
  });
});
