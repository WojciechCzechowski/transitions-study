import { describe, expect, it } from 'vitest';
import { FEEL, SOURCES, shortB } from './fixtures';
import { nextGalleryIndex } from './galleryNav';
import { applyTransition, setDuration } from './ops';
import { createDoc, cutFrame, resolveFrame, timelineLength, type Doc } from './timeline';
import { formatDuration, formatTimecode, roundToEven } from './time';

function withPush(duration: number): Doc {
  const r = applyTransition(shortB(), 'push', FEEL, { feel: 50 });
  if (!r.ok) throw new Error();
  return setDuration(r.doc, duration).doc;
}

describe('createDoc', () => {
  it('lays clips back to back with handles from the layout', () => {
    const doc = shortB();
    expect(doc.a).toMatchObject({ sourceIn: 15, sourceOut: 75, start: 0 });
    expect(doc.b).toMatchObject({ sourceIn: 18, sourceOut: 78, start: 60 });
    expect(cutFrame(doc)).toBe(60);
    expect(timelineLength(doc)).toBe(120);
  });

  it('reports a source that is too short for its layout', () => {
    const r = createDoc(SOURCES, [{ head: 15, visible: 60 }, { head: 70, visible: 60 }]);
    expect(r).toMatchObject({ ok: false, error: 'source-too-short', needed: 130, available: 120 });
  });

  it('rejects non-integer frame values', () => {
    expect(() => createDoc(SOURCES, [{ head: 1.5, visible: 60 }, { head: 0, visible: 60 }])).toThrow(RangeError);
  });
});

describe('resolveFrame', () => {
  it('shows a single clip outside the transition', () => {
    const doc = shortB();
    expect(resolveFrame(doc, 0)).toMatchObject({ kind: 'single', source: { clipId: 'a', frame: 15 } });
    expect(resolveFrame(doc, 59)).toMatchObject({ kind: 'single', source: { clipId: 'a', frame: 74 } });
    expect(resolveFrame(doc, 60)).toMatchObject({ kind: 'single', source: { clipId: 'b', frame: 18 } });
  });

  it('clamps frames outside the timeline', () => {
    const doc = shortB();
    expect(resolveFrame(doc, -5)).toMatchObject({ t: 0, source: { frame: 15 } });
    expect(resolveFrame(doc, 500)).toMatchObject({ t: 119, source: { clipId: 'b', frame: 77 } });
  });

  it('runs A into its tail handle and B from its head handle inside the transition', () => {
    const doc = withPush(24); // [48, 72)
    expect(resolveFrame(doc, 47).kind).toBe('single');
    expect(resolveFrame(doc, 48)).toMatchObject({
      kind: 'transition',
      from: { clipId: 'a', frame: 63 },
      to: { clipId: 'b', frame: 6 },
    });
    expect(resolveFrame(doc, 60)).toMatchObject({ from: { frame: 75 }, to: { frame: 18 } });
    expect(resolveFrame(doc, 71)).toMatchObject({ kind: 'transition', from: { frame: 86 }, to: { frame: 29 } });
    expect(resolveFrame(doc, 72)).toMatchObject({ kind: 'single', source: { clipId: 'b', frame: 30 } });
  });

  it('uses exactly the available handle frames at the maximum duration', () => {
    const doc = withPush(36); // [42, 78)
    expect(resolveFrame(doc, 42)).toMatchObject({ to: { frame: 0 } }); // B's first source frame
    expect(resolveFrame(doc, 77)).toMatchObject({ from: { frame: 92 } }); // within A's 120 frames
  });

  it('samples progress at frame centres, symmetric around the cut', () => {
    const doc = withPush(24);
    const p = (t: number) => {
      const r = resolveFrame(doc, t);
      return r.kind === 'transition' ? r.linear : NaN;
    };
    expect(p(48)).toBeCloseTo(0.5 / 24);
    expect(p(71)).toBeCloseTo(1 - 0.5 / 24);
    expect(p(59) + p(60)).toBeCloseTo(1);
    for (let t = 48; t < 71; t++) expect(p(t + 1)).toBeGreaterThan(p(t));
  });
});

describe('gallery navigation', () => {
  it('moves and clamps at the ends', () => {
    expect(nextGalleryIndex(0, 'ArrowRight', 6)).toBe(1);
    expect(nextGalleryIndex(5, 'ArrowRight', 6)).toBe(5);
    expect(nextGalleryIndex(0, 'ArrowLeft', 6)).toBe(0);
    expect(nextGalleryIndex(3, 'ArrowUp', 6)).toBe(2);
    expect(nextGalleryIndex(3, 'Home', 6)).toBe(0);
    expect(nextGalleryIndex(3, 'End', 6)).toBe(5);
    expect(nextGalleryIndex(3, 'Enter', 6)).toBeNull();
  });
});

describe('time formatting', () => {
  it('formats frames and seconds', () => {
    expect(formatDuration(24)).toBe('24 f · 0.80 s');
    expect(formatTimecode(74)).toBe('00:02:14');
    expect(formatTimecode(1830)).toBe('01:01:00');
    expect(roundToEven(7)).toBe(8);
    expect(roundToEven(6.9)).toBe(6);
  });
});
