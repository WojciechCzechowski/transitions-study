import { describe, expect, it } from 'vitest';
import { hasMarks, markedRange, markIn, markOut, NO_MARKS } from './marks';

describe('marks', () => {
  it('adds the whole clip without marks', () => {
    expect(markedRange(120, undefined)).toEqual({ sourceIn: 0, sourceOut: 120 });
    expect(markedRange(120, NO_MARKS)).toEqual({ sourceIn: 0, sourceOut: 120 });
    expect(hasMarks(NO_MARKS)).toBe(false);
  });

  it('includes both marked frames, and runs to the clip edge when one is unset', () => {
    expect(markedRange(120, { in: 20, out: 49 })).toEqual({ sourceIn: 20, sourceOut: 50 });
    expect(markedRange(120, { in: 100 })).toEqual({ sourceIn: 100, sourceOut: 120 });
    expect(markedRange(120, { out: 9 })).toEqual({ sourceIn: 0, sourceOut: 10 });
    expect(markedRange(120, { in: 60, out: 60 })).toEqual({ sourceIn: 60, sourceOut: 61 });
  });

  it('clears the other mark when a new one crosses it', () => {
    expect(markIn({ out: 30 }, 50)).toEqual({ in: 50 });
    expect(markIn({ out: 30 }, 10)).toEqual({ in: 10, out: 30 });
    expect(markOut({ in: 50 }, 30)).toEqual({ out: 30 });
    expect(markOut({ in: 10 }, 30)).toEqual({ in: 10, out: 30 });
  });
});
