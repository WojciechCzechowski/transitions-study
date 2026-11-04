import { describe, expect, it } from 'vitest';
import { cutAt, FEEL, generous, limitsAt, makeDoc, noHandleB, shortB } from './fixtures';
import { describeLimit, describeNoHandles } from './messages';
import { applyTransition, setDuration } from './ops';
import { clampDuration } from './timeline';

describe('getLimits', () => {
  it('is limited by the shorter handle: 2 × min(A tail, B head)', () => {
    const l = limitsAt(shortB());
    expect(l.available).toMatchObject({ aTail: 45, bHead: 18 });
    expect(l.max).toBe(36);
    expect(l.limitedBy).toBe('b-head');
    expect(l.canTransition).toBe(true);
  });

  it('reports A tail when that side is shorter', () => {
    const doc = makeDoc({ head: 15, visible: 95 }, { head: 40, visible: 60 }); // A tail = 10
    const l = limitsAt(doc);
    expect(l.max).toBe(20);
    expect(l.limitedBy).toBe('a-tail');
  });

  it('is limited by clip length when a clip is shorter than its handles', () => {
    const doc = makeDoc({ head: 0, visible: 6 }, { head: 45, visible: 60 }); // A tail 114, A length 6
    const l = limitsAt(doc);
    expect(l.max).toBe(12);
    expect(l.limitedBy).toBe('a-length');
  });

  it('shares a clip between the transitions at both of its ends', () => {
    // A [0,40) · B [40,60) · A [60,100): the middle clip is 20 f long.
    const doc0 = makeDoc({ head: 30, visible: 40 }, { head: 30, visible: 20 }, { head: 30, visible: 40 });
    const k0 = cutAt(doc0, 0).key;
    const r = applyTransition(doc0, k0, 'push', FEEL, { feel: 50 });
    if (!r.ok) throw new Error();
    const doc = setDuration(r.doc, k0, 30).doc; // uses 15 f of the middle clip
    expect(limitsAt(doc, 1)).toMatchObject({ max: 10, limitedBy: 'a-length' });
    expect(limitsAt(doc, 1).available.aLength).toBe(5);
  });

  it('always yields an even maximum', () => {
    for (const doc of [shortB(), generous()]) expect(limitsAt(doc).max % 2).toBe(0);
  });

  it('refuses when a side has no handle', () => {
    const l = limitsAt(noHandleB());
    expect(l.canTransition).toBe(false);
    expect(l.max).toBe(0);
    expect(l.available.bHead).toBe(0);
  });
});

describe('clampDuration', () => {
  const limits = limitsAt(shortB());

  it('passes through even values in range', () => {
    expect(clampDuration(24, limits)).toEqual({ duration: 24, clamped: null });
  });

  it('rounds odd requests to even', () => {
    expect(clampDuration(23, limits).duration).toBe(24);
    expect(clampDuration(25, limits).duration % 2).toBe(0);
  });

  it('stops at the maximum and says so', () => {
    expect(clampDuration(60, limits)).toEqual({ duration: 36, clamped: 'max' });
    expect(clampDuration(36, limits)).toEqual({ duration: 36, clamped: null });
  });

  it('stops at the minimum of 2 frames', () => {
    expect(clampDuration(0, limits)).toEqual({ duration: 2, clamped: 'min' });
    expect(clampDuration(-10, limits)).toEqual({ duration: 2, clamped: 'min' });
  });

  it('returns 0 when no transition is possible', () => {
    expect(clampDuration(24, limitsAt(noHandleB()))).toEqual({ duration: 0, clamped: 'max' });
  });
});

describe('limit messages', () => {
  it('explains the limit with the available frames', () => {
    const doc = shortB();
    expect(describeLimit(cutAt(doc), limitsAt(doc))).toBe(
      'Max 36 f (1.20 s): Clip B has only 18 frames before its in point',
    );
  });

  it('explains why no centred transition fits', () => {
    const doc = noHandleB();
    const msg = describeNoHandles(cutAt(doc), limitsAt(doc));
    expect(msg).toContain('Clip B has 0 frames before its in point');
    expect(msg).toContain('Available: Clip A 45 f after its out point, Clip B 0 f before its in point');
  });
});
