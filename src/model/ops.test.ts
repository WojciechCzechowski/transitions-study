import { describe, expect, it } from 'vitest';
import { FEEL, generous, noHandleB, shortB } from './fixtures';
import { applyTransition, removeTransition, setDuration, setFeel } from './ops';
import { cutFrame, transitionRange, type Doc } from './timeline';

function applied(doc: Doc, presetId = 'push', feel = 50): Doc {
  const r = applyTransition(doc, presetId, FEEL, { feel });
  if (!r.ok) throw new Error('expected apply to succeed');
  return r.doc;
}

describe('applyTransition', () => {
  it('creates one transition centred on the cut, sized by Feel', () => {
    const doc = shortB();
    const r = applyTransition(doc, 'push', FEEL, { feel: 50 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.transition).toMatchObject({ presetId: 'push', duration: 24, feel: 50 });
    const range = transitionRange(r.doc)!;
    expect(cutFrame(r.doc) - range.start).toBe(range.end - cutFrame(r.doc));
    expect(r.replaced).toBe(false);
    // The source document is untouched.
    expect(doc.transition).toBeNull();
  });

  it('clamps a new transition to the available handles and reports it', () => {
    const r = applyTransition(shortB(), 'wipe', FEEL, { feel: 100 });
    expect(r.ok && r.doc.transition?.duration).toBe(36);
    expect(r.ok && r.clamped).toBe('max');
  });

  it('replacing the preset keeps duration and feel', () => {
    const first = setDuration(applied(generous(), 'push', 20), 30).doc;
    const r = applyTransition(first, 'blur', FEEL, { feel: 90 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.replaced).toBe(true);
    expect(r.doc.transition).toMatchObject({ presetId: 'blur', duration: 30, feel: 20 });
  });

  it('re-applying the same preset is a no-op (same reference)', () => {
    const doc = applied(shortB(), 'zoom');
    const r = applyTransition(doc, 'zoom', FEEL, { feel: 0 });
    expect(r.ok && r.doc).toBe(doc);
  });

  it('refuses with an explanation when a clip has no handle', () => {
    const r = applyTransition(noHandleB(), 'push', FEEL, { feel: 50 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('no-handles');
    expect(r.limits.available).toMatchObject({ aTail: 45, bHead: 0 });
  });
});

describe('removeTransition', () => {
  it('removes the transition', () => {
    const doc = applied(shortB());
    expect(removeTransition(doc).transition).toBeNull();
  });

  it('is a no-op when there is none', () => {
    const doc = shortB();
    expect(removeTransition(doc)).toBe(doc);
  });

  it('apply → remove gives back an equivalent clip layout', () => {
    const doc = shortB();
    const back = removeTransition(applied(doc));
    expect(back.a).toBe(doc.a);
    expect(back.b).toBe(doc.b);
  });
});

describe('setDuration', () => {
  it('changes duration and keeps it even', () => {
    const r = setDuration(applied(shortB()), 13);
    expect(r.doc.transition?.duration).toBe(14);
  });

  it('stops at the handle limit', () => {
    const r = setDuration(applied(shortB()), 80);
    expect(r).toMatchObject({ clamped: 'max', doc: { transition: { duration: 36 } } });
  });

  it('returns the same reference when nothing changes', () => {
    const doc = applied(shortB());
    expect(setDuration(doc, doc.transition!.duration).doc).toBe(doc);
  });
});

describe('setFeel', () => {
  it('sets duration together with feel', () => {
    const doc = applied(generous(), 'push', 50);
    const r = setFeel(doc, 0, FEEL);
    expect(r.doc.transition).toMatchObject({ feel: 0, duration: 8 });
  });

  it('flags when Feel wants more than the handles allow', () => {
    const r = setFeel(applied(shortB()), 100, FEEL);
    expect(r).toMatchObject({ clamped: 'max', doc: { transition: { feel: 100, duration: 36 } } });
  });

  it('overrides a manually dragged duration', () => {
    const dragged = setDuration(applied(generous(), 'push', 50), 60).doc;
    expect(setFeel(dragged, 50, FEEL).doc.transition?.duration).toBe(24);
  });
});
