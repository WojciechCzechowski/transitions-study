import { describe, expect, it } from 'vitest';
import { cutAt, generous, limitsAt, makeDoc, noHandleB, shortB, tooShortB } from './fixtures';
import { describeLimit, describeNoHandles, describeTrim, describeTrimWarning } from './messages';
import { applyTransition, setDuration } from './ops';
import { clampDuration } from './timeline';

describe('getLimits', () => {
  it('fits 2 × the shorter handle untrimmed, and reaches further by trimming', () => {
    const l = limitsAt(shortB());
    expect(l.available).toMatchObject({ aTail: 45, bHead: 18, aLength: 60, bLength: 60 });
    expect(l.fit).toBe(36);
    // B gives its 18 f of handle plus half of what is left of its length once trimmed: (60 + 18) / 2 = 39.
    expect(l.max).toBe(78);
    expect(l.limitedBy).toBe('b-length');
    expect(l.canTransition).toBe(true);
  });

  it('reports A when that clip gives less', () => {
    const doc = makeDoc({ head: 15, visible: 30 }, { head: 40, visible: 60 }); // A 30 f long, 75 f tail
    const l = limitsAt(doc);
    expect(l.max).toBe(60);
    expect(l.limitedBy).toBe('a-length');
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
    const r = applyTransition(doc0, k0, 'push', { feel: 50, duration: 24 });
    if (!r.ok) throw new Error();
    const doc = setDuration(r.doc, k0, 30).doc; // uses 15 f of the middle clip
    expect(limitsAt(doc, 1)).toMatchObject({ max: 10, limitedBy: 'a-length' });
    expect(limitsAt(doc, 1).available.aLength).toBe(5);
  });

  it('always yields an even maximum', () => {
    for (const doc of [shortB(), generous()]) expect(limitsAt(doc).max % 2).toBe(0);
  });

  it('takes a transition where a side has no handle, by trimming it', () => {
    const l = limitsAt(noHandleB());
    expect(l.available.bHead).toBe(0);
    expect(l.fit).toBe(0);
    expect(l.canTransition).toBe(true);
    expect(l.max).toBe(60); // B: 60 f long, half of it trimmed into handle
    expect(l.limitedBy).toBe('b-length');
  });

  it('refuses only when a clip is too short to give up a frame', () => {
    const l = limitsAt(tooShortB());
    expect(l.canTransition).toBe(false);
    expect(l.max).toBe(0);
  });

  it('keeps the same reach once the clips are trimmed to make room', () => {
    const doc = noHandleB();
    const r = applyTransition(doc, cutAt(doc).key, 'push', { feel: 50, duration: 40 });
    if (!r.ok) throw new Error();
    expect(r.trimmed).toEqual({ a: 0, b: 20 });
    expect(limitsAt(r.doc).max).toBe(limitsAt(doc).max);
    expect(limitsAt(r.doc).fit).toBe(40);
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
    expect(clampDuration(100, limits)).toEqual({ duration: 78, clamped: 'max' });
    expect(clampDuration(78, limits)).toEqual({ duration: 78, clamped: null });
  });

  it('stops at the minimum of 2 frames', () => {
    expect(clampDuration(0, limits)).toEqual({ duration: 2, clamped: 'min' });
    expect(clampDuration(-10, limits)).toEqual({ duration: 2, clamped: 'min' });
  });

  it('returns 0 when no transition is possible', () => {
    expect(clampDuration(24, limitsAt(tooShortB()))).toEqual({ duration: 0, clamped: 'max' });
  });
});

describe('limit messages', () => {
  it('explains the limit with the frames the clip can give', () => {
    const doc = shortB();
    expect(describeLimit(cutAt(doc), limitsAt(doc))).toBe(
      'Max 78 f (2.60 s): Clip B has only 60 frames of length to spare and 18 frames before its in point',
    );
    const bare = noHandleB();
    expect(describeLimit(cutAt(bare), limitsAt(bare))).toBe('Max 60 f (2.00 s): Clip B has only 60 frames of length to spare');
  });

  it('explains why no centred transition fits', () => {
    const doc = tooShortB();
    const msg = describeNoHandles(cutAt(doc), limitsAt(doc));
    expect(msg).toContain('Clip B has only 1 frame of length to spare');
    expect(msg).not.toContain('Clip A');
  });

  /** The messages keep each "0.60 s (18 f)" together with no-break spaces; compare as plain text. */
  const plain = (m: string) => m.replace(/\u00a0/g, ' ');

  it('says what making room trimmed, and why', () => {
    expect(describeTrim(cutAt(shortB()), { a: 0, b: 21 }, 78)).toContain('0.60\u00a0s\u00a0(18\u00a0f)');
    const cut = cutAt(shortB());
    expect(plain(describeTrim(cut, { a: 0, b: 21 }, 78))).toBe(
      'Trimmed right clip by 0.70 s (21 f) to make room: Clip B has only 0.60 s (18 f) of footage before its start, ' +
        'and a centred 2.60 s (78 f) transition needs 1.30 s (39 f) on each side.',
    );
    expect(plain(describeTrim(cut, { a: 4, b: 21 }, 78))).toBe(
      'Trimmed left clip by 0.13 s (4 f) and right clip by 0.70 s (21 f) to make room: ' +
        'Clip A has only 1.17 s (35 f) of footage after its end and Clip B has only 0.60 s (18 f) of footage before its start, ' +
        'and a centred 2.60 s (78 f) transition needs 1.30 s (39 f) on each side.',
    );
    expect(describeTrim(cut, { a: 0, b: 0 }, 78)).toBe('');
  });

  it('warns what applying would trim, and why, from the real apply', () => {
    const doc = shortB();
    const cut = cutAt(doc);
    const r = applyTransition(doc, cut.key, 'crossDissolve', { feel: 50, duration: 78 });
    if (!r.ok) throw new Error('apply failed');
    expect(r.trimmed).toEqual({ a: 0, b: 21 });
    expect(plain(describeTrimWarning(cut, r.trimmed, r.transition.duration))).toBe(
      'Will trim right clip by 0.70 s (21 f): Clip B has only 0.60 s (18 f) of footage before its start, ' +
        'and a centred 2.60 s (78 f) transition needs 1.30 s (39 f) on each side.',
    );
    expect(describeTrimWarning(cut, { a: 0, b: 0 }, 24)).toBe('');
  });
});
