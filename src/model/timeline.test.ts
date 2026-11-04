import { describe, expect, it } from 'vitest';
import { cutAt, makeDoc, SOURCES, shortB } from './fixtures';
import { nextGalleryIndex } from './galleryNav';
import { applyTransition, setDuration } from './ops';
import { clipStarts, createDoc, cuts, normalize, resolveFrame, timelineLength, type Doc } from './timeline';
import { formatDuration, formatTimecode, roundToEven } from './time';

function withPush(duration: number, doc = shortB(), n = 0): Doc {
  const key = cutAt(doc, n).key;
  const r = applyTransition(doc, key, 'push', { feel: 50, duration: 24 });
  if (!r.ok) throw new Error();
  return setDuration(r.doc, key, duration).doc;
}

describe('createDoc', () => {
  it('lays clips back to back with handles from the layout', () => {
    const doc = shortB();
    expect(doc.clips[0]).toMatchObject({ id: 'c1', sourceId: 'a', sourceIn: 15, sourceOut: 75 });
    expect(doc.clips[1]).toMatchObject({ id: 'c2', sourceId: 'b', sourceIn: 18, sourceOut: 78 });
    expect(clipStarts(doc)).toEqual([0, 60]);
    expect(cuts(doc)).toMatchObject([{ key: 'c1|c2', frame: 60, index: 0 }]);
    expect(timelineLength(doc)).toBe(120);
    expect(doc.nextId).toBe(3);
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
    expect(resolveFrame(doc, 0)).toMatchObject({ kind: 'single', source: { sourceId: 'a', frame: 15 } });
    expect(resolveFrame(doc, 59)).toMatchObject({ kind: 'single', source: { sourceId: 'a', frame: 74 } });
    expect(resolveFrame(doc, 60)).toMatchObject({ kind: 'single', source: { sourceId: 'b', frame: 18 } });
  });

  it('clamps frames outside the timeline', () => {
    const doc = shortB();
    expect(resolveFrame(doc, -5)).toMatchObject({ t: 0, source: { frame: 15 } });
    expect(resolveFrame(doc, 500)).toMatchObject({ t: 119, source: { sourceId: 'b', frame: 77 } });
  });

  it('runs A into its tail handle and B from its head handle inside the transition', () => {
    const doc = withPush(24); // [48, 72)
    expect(resolveFrame(doc, 47).kind).toBe('single');
    expect(resolveFrame(doc, 48)).toMatchObject({
      kind: 'transition',
      from: { sourceId: 'a', frame: 63 },
      to: { sourceId: 'b', frame: 6 },
    });
    expect(resolveFrame(doc, 60)).toMatchObject({ from: { frame: 75 }, to: { frame: 18 } });
    expect(resolveFrame(doc, 71)).toMatchObject({ kind: 'transition', from: { frame: 86 }, to: { frame: 29 } });
    expect(resolveFrame(doc, 72)).toMatchObject({ kind: 'single', source: { sourceId: 'b', frame: 30 } });
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

  it('handles transitions on several cuts', () => {
    // A [0,40) · B [40,80) · A [80,120)
    let doc = makeDoc({ head: 30, visible: 40 }, { head: 30, visible: 40 }, { head: 30, visible: 40 });
    doc = withPush(10, doc, 0); // [35, 45)
    doc = withPush(20, doc, 1); // [70, 90)
    expect(resolveFrame(doc, 34).kind).toBe('single');
    expect(resolveFrame(doc, 35)).toMatchObject({ kind: 'transition', from: { sourceId: 'a', frame: 65 }, to: { sourceId: 'b', frame: 25 } });
    expect(resolveFrame(doc, 50)).toMatchObject({ kind: 'single', source: { sourceId: 'b', frame: 40 } });
    expect(resolveFrame(doc, 70)).toMatchObject({ kind: 'transition', from: { sourceId: 'b', frame: 60 }, to: { sourceId: 'a', frame: 20 } });
    expect(resolveFrame(doc, 89)).toMatchObject({ kind: 'transition', from: { frame: 79 }, to: { frame: 39 } });
    expect(resolveFrame(doc, 90)).toMatchObject({ kind: 'single', source: { sourceId: 'a', frame: 40 } });
  });

  it('applies a preview override at one cut', () => {
    const doc = shortB();
    const override = { cutKey: 'c1|c2', look: { presetId: 'wipe', duration: 10, feel: 0 } };
    expect(resolveFrame(doc, 55, override)).toMatchObject({ kind: 'transition', presetId: 'wipe' });
    const hidden = { cutKey: 'c1|c2', look: null };
    expect(resolveFrame(withPush(24), 55, hidden).kind).toBe('single');
  });
});

describe('normalize', () => {
  it('drops transitions whose clips are no longer adjacent, and shrinks the rest to fit', () => {
    const doc = withPush(24);
    expect(normalize(doc)).toBe(doc);
    const swapped = normalize({ ...doc, clips: [doc.clips[1]!, doc.clips[0]!] });
    expect(swapped.transitions).toHaveLength(0);
    const shorterHandle = normalize({ ...doc, clips: [doc.clips[0]!, { ...doc.clips[1]!, sourceIn: 5, sourceOut: 65 }] });
    expect(shorterHandle.transitions[0]?.duration).toBe(10);
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
