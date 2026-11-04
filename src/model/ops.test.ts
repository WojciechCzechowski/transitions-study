import { describe, expect, it } from 'vitest';
import { cutAt, generous, makeDoc, noHandleB, shortB, SOURCES, tooShortB } from './fixtures';
import {
  applyTransition,
  clearIntensity,
  deleteClip,
  insertAtFrame,
  insertClip,
  insertClipRange,
  insertRange,
  moveClip,
  removeTransition,
  setDuration,
  resetTuning,
  setEasing,
  setFeel,
  setIntensity,
  splitClip,
  trimBounds,
  trimClip,
} from './ops';
import { clipStarts, cuts, NO_ROOM, timelineLength, transitionAt, transitionRange, type Doc } from './timeline';

function applied(doc: Doc, presetId = 'push', feel = 50, n = 0): Doc {
  const r = applyTransition(doc, cutAt(doc, n).key, presetId, { feel, duration: 24 });
  if (!r.ok) throw new Error('expected apply to succeed');
  return r.doc;
}

const only = (doc: Doc) => doc.transitions[0];

describe('clearIntensity', () => {
  it('drops the Fine-tuned intensity and keeps the curve', () => {
    const r = applyTransition(shortB(), 'c1|c2', 'blur', { feel: 50, duration: 24, look: { feel: 30, easing: [0, 0, 1, 1], intensity: 0.8 } });
    if (!r.ok) throw new Error();
    const t = only(clearIntensity(r.doc, 'c1|c2'));
    expect(t?.intensity).toBeUndefined();
    expect(t?.easing).toEqual([0, 0, 1, 1]);
    expect(t?.feel).toBe(30);
  });
});

describe('applyTransition', () => {
  it('creates one transition centred on the cut at the requested duration', () => {
    const doc = shortB();
    const cut = cutAt(doc);
    const r = applyTransition(doc, cut.key, 'push', { feel: 50, duration: 24 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(only(r.doc)).toMatchObject({ id: 't3', fromId: 'c1', toId: 'c2', presetId: 'push', duration: 24, feel: 50 });
    const range = transitionRange(cut, 24);
    expect(cut.frame - range.start).toBe(range.end - cut.frame);
    expect(r.replaced).toBe(false);
    expect(r.doc.nextId).toBe(4);
    expect(doc.transitions).toHaveLength(0);
  });

  it('takes a drafted look for a new transition', () => {
    const doc = shortB();
    const r = applyTransition(doc, 'c1|c2', 'blur', { feel: 50, duration: 24, look: { feel: 20, easing: [0, 0, 1, 1], intensity: 0.7 } });
    if (!r.ok) throw new Error();
    expect(only(r.doc)).toMatchObject({ presetId: 'blur', duration: 24, feel: 20, easing: [0, 0, 1, 1], intensity: 0.7 });
  });

  it('a drafted look replaces the old look but keeps the duration', () => {
    const doc = shortB();
    const first = applyTransition(doc, 'c1|c2', 'push', { feel: 50, duration: 30 });
    if (!first.ok) throw new Error();
    const tunedPush = setIntensity(first.doc, 'c1|c2', 0.4);
    const r = applyTransition(tunedPush, 'c1|c2', 'zoom', { feel: 50, duration: 24, look: { feel: 90 } });
    if (!r.ok) throw new Error();
    expect(only(r.doc)).toMatchObject({ presetId: 'zoom', duration: 30, feel: 90 });
    expect(only(r.doc)?.intensity).toBeUndefined();
  });

  it('a drafted duration wins, for a new transition and a replacement', () => {
    const doc = shortB();
    const first = applyTransition(doc, 'c1|c2', 'push', { feel: 50, duration: 24, look: { feel: 50, duration: 30 } });
    if (!first.ok) throw new Error();
    expect(only(first.doc)?.duration).toBe(30);
    const r = applyTransition(first.doc, 'c1|c2', 'wipe', { feel: 50, duration: 24, look: { feel: 50, duration: 40 } });
    if (!r.ok) throw new Error();
    expect(only(r.doc)).toMatchObject({ presetId: 'wipe', duration: 40 });
    expect(r.trimmed).toEqual({ a: 0, b: 2 }); // B head is 18: 2 short of half of 40
  });

  it('trims nothing when the handles are enough', () => {
    const doc = shortB();
    const r = applyTransition(doc, 'c1|c2', 'wipe', { feel: 100, duration: 36 });
    if (!r.ok) throw new Error();
    expect(r.trimmed).toBe(NO_ROOM);
    expect(r.doc.clips).toEqual(doc.clips);
  });

  it('trims only the short side, by what its handle lacks, and ripples', () => {
    const doc = shortB(); // A tail 45, B head 18
    const r = applyTransition(doc, 'c1|c2', 'wipe', { feel: 100, duration: 40 });
    if (!r.ok) throw new Error();
    expect(only(r.doc)?.duration).toBe(40);
    expect(r.clamped).toBe(null);
    expect(r.trimmed).toEqual({ a: 0, b: 2 });
    expect(r.doc.clips[0]).toEqual(doc.clips[0]);
    expect(r.doc.clips[1]).toMatchObject({ sourceIn: 20, sourceOut: 78 });
    expect(timelineLength(r.doc)).toBe(timelineLength(doc) - 2);
  });

  it('trims both clips when neither has a handle, shifting later clips and transitions', () => {
    const full = { head: 0, visible: 120 };
    let doc = makeDoc(full, full, full);
    const first = applyTransition(doc, 'c1|c2', 'push', { feel: 50, duration: 24 });
    if (!first.ok) throw new Error();
    expect(first.trimmed).toEqual({ a: 12, b: 12 });
    doc = first.doc;
    expect(doc.clips.map((c) => [c.sourceIn, c.sourceOut])).toEqual([[0, 108], [12, 120], [0, 120]]);
    expect(cuts(doc).map((c) => c.frame)).toEqual([108, 216]);

    const second = applyTransition(doc, 'c2|c3', 'push', { feel: 50, duration: 24 });
    if (!second.ok) throw new Error();
    expect(second.trimmed).toEqual({ a: 12, b: 12 });
    expect(second.doc.transitions.map((t) => t.duration)).toEqual([24, 24]);
    expect(cuts(second.doc).map((c) => c.frame)).toEqual([108, 204]);
    expect(timelineLength(second.doc)).toBe(360 - 48);
  });

  it('clamps a new transition to what the clips can give and reports it', () => {
    const r = applyTransition(shortB(), 'c1|c2', 'wipe', { feel: 100, duration: 200 });
    if (!r.ok) throw new Error();
    expect(only(r.doc)?.duration).toBe(78);
    expect(r.clamped).toBe('max');
    expect(r.trimmed).toEqual({ a: 0, b: 21 });
  });

  it('replacing the preset trims nothing more', () => {
    const doc = applied(noHandleB());
    const r = applyTransition(doc, 'c1|c2', 'blur', { feel: 50, duration: 60 });
    if (!r.ok) throw new Error();
    expect(r.trimmed).toBe(NO_ROOM);
    expect(r.doc.clips).toEqual(doc.clips);
  });

  it('replacing the preset keeps duration and feel', () => {
    const first = setDuration(applied(generous(), 'push', 20), 'c1|c2', 30).doc;
    const r = applyTransition(first, 'c1|c2', 'blur', { feel: 90, duration: 36 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.replaced).toBe(true);
    expect(only(r.doc)).toMatchObject({ presetId: 'blur', duration: 30, feel: 20 });
    expect(r.doc.transitions).toHaveLength(1);
  });

  it('re-applying the same preset is a no-op (same reference)', () => {
    const doc = applied(shortB(), 'zoom');
    const r = applyTransition(doc, 'c1|c2', 'zoom', { feel: 0, duration: 8 });
    expect(r.ok && r.doc).toBe(doc);
  });

  it('refuses with an explanation when a clip is too short to make room', () => {
    const r = applyTransition(tooShortB(), 'c1|c2', 'push', { feel: 50, duration: 24 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('no-handles');
    expect(r.limits?.available).toMatchObject({ bHead: 0, bLength: 1 });
  });

  it('refuses an unknown cut', () => {
    expect(applyTransition(shortB(), 'x|y', 'push', { feel: 50, duration: 24 })).toMatchObject({ ok: false, error: 'no-cut' });
  });
});

describe('removeTransition / setDuration / setFeel', () => {
  it('removes, and is a no-op when there is none', () => {
    expect(removeTransition(applied(shortB()), 'c1|c2').transitions).toHaveLength(0);
    const doc = shortB();
    expect(removeTransition(doc, 'c1|c2')).toBe(doc);
  });

  it('keeps duration even and stops at what the clips can give', () => {
    expect(only(setDuration(applied(shortB()), 'c1|c2', 13).doc)?.duration).toBe(14);
    expect(setDuration(applied(shortB()), 'c1|c2', 80)).toMatchObject({ clamped: 'max' });
    const doc = applied(shortB());
    expect(setDuration(doc, 'c1|c2', 24).doc).toBe(doc);
  });

  it('trims to make room when growing, and leaves the handles when shrinking', () => {
    const doc = applied(noHandleB()); // 24 f: B trimmed by 12
    expect(doc.clips[1]).toMatchObject({ sourceIn: 12 });

    const grown = setDuration(doc, 'c1|c2', 40);
    expect(grown.trimmed).toEqual({ a: 0, b: 8 });
    expect(grown.doc.clips[1]).toMatchObject({ sourceIn: 20 });
    expect(only(grown.doc)?.duration).toBe(40);

    const shrunk = setDuration(grown.doc, 'c1|c2', 10);
    expect(shrunk.trimmed).toBe(NO_ROOM);
    expect(shrunk.doc.clips).toEqual(grown.doc.clips);
    expect(only(shrunk.doc)?.duration).toBe(10);

    // Within the handles it now has, growing again trims nothing.
    expect(setDuration(shrunk.doc, 'c1|c2', 40).trimmed).toBe(NO_ROOM);
  });

  it('Feel never changes duration', () => {
    const doc = applied(generous());
    expect(only(setFeel(doc, 'c1|c2', 0))).toMatchObject({ feel: 0, duration: 24 });
    expect(only(setFeel(doc, 'c1|c2', 100))).toMatchObject({ feel: 100, duration: 24 });
    expect(setFeel(doc, 'c1|c2', 50)).toBe(doc);
  });
});

describe('Fine-tune', () => {
  const CURVE = [0, 0, 0.58, 1] as const;

  it('overrides easing and intensity without touching Feel or duration', () => {
    const doc = setIntensity(setEasing(applied(generous()), 'c1|c2', CURVE), 'c1|c2', 0.456);
    expect(only(doc)).toMatchObject({ feel: 50, duration: 24, easing: CURVE, intensity: 0.46 });
  });

  it('clamps intensity to 0…1', () => {
    expect(only(setIntensity(applied(generous()), 'c1|c2', 3))?.intensity).toBe(1);
    expect(only(setIntensity(applied(generous()), 'c1|c2', -1))?.intensity).toBe(0);
  });

  it('moving Feel or resetting drops the overrides', () => {
    const tunedDoc = setIntensity(setEasing(applied(generous()), 'c1|c2', CURVE), 'c1|c2', 0.5);
    for (const doc of [setFeel(tunedDoc, 'c1|c2', 50), resetTuning(tunedDoc, 'c1|c2')]) {
      const t = only(doc)!;
      expect(t.easing).toBeUndefined();
      expect(t.intensity).toBeUndefined();
      expect('easing' in t || 'intensity' in t).toBe(false);
    }
  });

  it('a preset swap keeps the curve but drops the intensity', () => {
    const tunedDoc = setIntensity(setEasing(applied(generous()), 'c1|c2', CURVE), 'c1|c2', 0.5);
    const r = applyTransition(tunedDoc, 'c1|c2', 'wipe', { feel: 50, duration: 24 });
    expect(r.ok && only(r.doc)).toMatchObject({ presetId: 'wipe', easing: CURVE });
    expect(r.ok && only(r.doc)?.intensity).toBeUndefined();
  });

  it('no-op edits keep the same document', () => {
    const doc = setEasing(applied(generous()), 'c1|c2', CURVE);
    expect(setEasing(doc, 'c1|c2', [...CURVE])).toBe(doc);
    const plain = applied(generous());
    expect(resetTuning(plain, 'c1|c2')).toBe(plain);
  });
});

describe('insertClip', () => {
  it('adds the whole source', () => {
    expect(insertRange(120)).toEqual({ sourceIn: 0, sourceOut: 120 });
    expect(insertRange(1)).toEqual({ sourceIn: 0, sourceOut: 1 });
  });

  it('inserts at a boundary and shifts later clips', () => {
    const { doc, clip } = insertClip(shortB(), SOURCES[0], 1);
    expect(clip).toMatchObject({ id: 'c3', sourceId: 'a', sourceIn: 0, sourceOut: 120 });
    expect(doc.clips.map((c) => c.id)).toEqual(['c1', 'c3', 'c2']);
    expect(clipStarts(doc)).toEqual([0, 60, 180]);
    expect(timelineLength(doc)).toBe(240);
    expect(doc.nextId).toBe(4);
  });

  it('can add the same source many times, and drops a transition whose cut it splits', () => {
    let doc = applied(shortB());
    doc = insertClip(doc, SOURCES[0], 2).doc;
    doc = insertClip(doc, SOURCES[0], 2).doc;
    expect(doc.clips.filter((c) => c.sourceId === 'a')).toHaveLength(3);
    expect(doc.transitions).toHaveLength(1);
    doc = insertClip(doc, SOURCES[1], 1).doc;
    expect(doc.transitions).toHaveLength(0);
  });
});

describe('insertAtFrame', () => {
  const RANGE = { sourceIn: 10, sourceOut: 40 }; // 30 frames
  const ids = (doc: Doc) => doc.clips.map((c) => `${c.sourceId}${c.sourceIn}-${c.sourceOut}`);

  it('splits the clip under the playhead and puts the new clip in the gap', () => {
    const r = insertAtFrame(shortB(), SOURCES[1], 30, RANGE);
    if (!r.ok) throw new Error('expected insert');
    expect(ids(r.doc)).toEqual(['a15-45', 'b10-40', 'a45-75', 'b18-78']);
    expect(r.at).toBe(30);
    expect(timelineLength(r.doc)).toBe(150);
  });

  it('goes straight in on a cut and at either end', () => {
    const onCut = insertAtFrame(shortB(), SOURCES[1], 60, RANGE);
    if (!onCut.ok) throw new Error('expected insert');
    expect(ids(onCut.doc)).toEqual(['a15-75', 'b10-40', 'b18-78']);
    expect(onCut.at).toBe(60);

    const start = insertAtFrame(shortB(), SOURCES[1], 0, RANGE);
    if (!start.ok) throw new Error('expected insert');
    expect(ids(start.doc)[0]).toBe('b10-40');
    expect(start.at).toBe(0);

    const end = insertAtFrame(shortB(), SOURCES[1], 120, RANGE);
    if (!end.ok) throw new Error('expected insert');
    expect(ids(end.doc).at(-1)).toBe('b10-40');
    expect(end.at).toBe(120);
  });

  it('fills an empty timeline', () => {
    const empty = deleteClip(deleteClip(shortB(), 'c1'), 'c2');
    const r = insertAtFrame(empty, SOURCES[0], 0, RANGE);
    if (!r.ok) throw new Error('expected insert');
    expect(ids(r.doc)).toEqual(['a10-40']);
  });

  it('refuses inside a transition, including exactly on its cut, and keeps other transitions', () => {
    const doc = applied(shortB()); // spans 48–71
    expect(insertAtFrame(doc, SOURCES[1], 60, RANGE)).toMatchObject({ ok: false, reason: 'in-transition' });
    expect(insertAtFrame(doc, SOURCES[1], 50, RANGE)).toMatchObject({ ok: false, reason: 'in-transition' });
    const r = insertAtFrame(doc, SOURCES[1], 30, RANGE);
    if (!r.ok) throw new Error('expected insert');
    expect(r.doc.transitions).toHaveLength(1);
    const last = cuts(r.doc)[2]!;
    expect(last.frame).toBe(90);
    expect(transitionAt(r.doc, last.key)).toBeTruthy();
  });

  it('keeps the inserted range inside the source', () => {
    const { clip } = insertClipRange(shortB(), SOURCES[0], 0, { sourceIn: -5, sourceOut: 500 });
    expect(clip).toMatchObject({ sourceIn: 0, sourceOut: 120 });
    const tiny = insertClipRange(shortB(), SOURCES[0], 0, { sourceIn: 50, sourceOut: 50 }).clip;
    expect(tiny.sourceOut - tiny.sourceIn).toBe(1);
  });
});

describe('moveClip and deleteClip', () => {
  it('reorders, keeping the order unchanged for a no-op move', () => {
    const doc = insertClip(shortB(), SOURCES[0], 2).doc; // c1 c2 c3
    expect(moveClip(doc, 'c1', 0)).toBe(doc);
    expect(moveClip(doc, 'c1', 1)).toBe(doc);
    expect(moveClip(doc, 'c1', 3).clips.map((c) => c.id)).toEqual(['c2', 'c3', 'c1']);
    expect(moveClip(doc, 'c3', 0).clips.map((c) => c.id)).toEqual(['c3', 'c1', 'c2']);
  });

  it('drops transitions that lose their pair on a move', () => {
    const doc = applied(insertClip(shortB(), SOURCES[0], 2).doc); // transition on c1|c2
    expect(moveClip(doc, 'c3', 0).transitions).toHaveLength(1);
    expect(moveClip(doc, 'c2', 0).transitions).toHaveLength(0);
  });

  it('ripple-deletes a clip with the transitions on its cuts', () => {
    const doc = applied(insertClip(shortB(), SOURCES[0], 2).doc);
    const r = deleteClip(doc, 'c2');
    expect(r.clips.map((c) => c.id)).toEqual(['c1', 'c3']);
    expect(r.transitions).toHaveLength(0);
    expect(timelineLength(r)).toBe(60 + 120);
  });

  it('can delete every clip, leaving an empty timeline', () => {
    const one = deleteClip(shortB(), 'c2');
    const none = deleteClip(one, 'c1');
    expect(none.clips).toEqual([]);
    expect(none.transitions).toEqual([]);
    expect(timelineLength(none)).toBe(0);
    expect(cuts(none)).toEqual([]);
    expect(splitClip(none, 0)).toEqual({ ok: false, reason: 'outside' });
    // A clip can be dropped back onto the empty timeline.
    const back = insertClip(none, SOURCES[0], 0).doc;
    expect(back.clips).toHaveLength(1);
  });
});

describe('splitClip', () => {
  it('splits into two instances that meet at a new cut with full handles', () => {
    const r = splitClip(shortB(), 20);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.clips.map((c) => c.id)).toEqual(['c1', 'c3', 'c2']);
    expect(r.left).toMatchObject({ sourceIn: 15, sourceOut: 35 });
    expect(r.right).toMatchObject({ sourceId: 'a', sourceIn: 35, sourceOut: 75 });
    expect(timelineLength(r.doc)).toBe(120);
    expect(cuts(r.doc).map((c) => c.frame)).toEqual([20, 60]);
  });

  it('moves the outgoing transition to the right part', () => {
    const r = splitClip(applied(shortB()), 20); // push 24 on c1|c2
    expect(r.ok && r.doc.transitions[0]).toMatchObject({ fromId: 'c4', toId: 'c2', duration: 24 }); // c4: nextId moved past the transition's t3
  });

  it('refuses on a cut, outside the timeline, or inside a transition', () => {
    const doc = applied(shortB()); // [48, 72)
    expect(splitClip(doc, 60)).toMatchObject({ ok: false, reason: 'on-cut' });
    expect(splitClip(doc, 0)).toMatchObject({ ok: false, reason: 'outside' });
    expect(splitClip(doc, 120)).toMatchObject({ ok: false, reason: 'outside' });
    expect(splitClip(doc, 50)).toMatchObject({ ok: false, reason: 'in-transition' });
    expect(splitClip(doc, 70)).toMatchObject({ ok: false, reason: 'in-transition' });
    expect(splitClip(doc, 48).ok).toBe(true);
    expect(splitClip(doc, 72).ok).toBe(true);
  });
});

describe('trimClip', () => {
  it('moves an edge within the source and shifts later clips', () => {
    const r = trimClip(shortB(), 'c1', 'end', 85);
    expect(r).toMatchObject({ limit: null });
    expect(r.doc.clips[0]).toMatchObject({ sourceOut: 85 });
    expect(clipStarts(r.doc)).toEqual([0, 70]);
    const start = trimClip(shortB(), 'c2', 'start', 10);
    expect(start.doc.clips[1]).toMatchObject({ sourceIn: 10, sourceOut: 78 });
  });

  it('stops at the source and reports it', () => {
    expect(trimClip(shortB(), 'c1', 'start', -20)).toMatchObject({ limit: 'source-start', doc: { clips: [{ sourceIn: 0 }, {}] } });
    expect(trimClip(shortB(), 'c1', 'end', 500)).toMatchObject({ limit: 'source-end', doc: { clips: [{ sourceOut: 120 }, {}] } });
    expect(trimClip(shortB(), 'c1', 'end', 0)).toMatchObject({ limit: 'min-length', doc: { clips: [{ sourceOut: 16 }, {}] } });
  });

  it('shrinks the transition on the trimmed edge and stops at its minimum', () => {
    const doc = applied(shortB()); // push 24, A tail 45, B head 18
    const r = trimClip(doc, 'c2', 'start', 6); // B head handle → 6
    expect(r.limit).toBeNull();
    expect(transitionAt(r.doc, 'c1|c2')?.duration).toBe(12);
    const stop = trimClip(doc, 'c2', 'start', 0);
    expect(stop.limit).toBe('edge-transition');
    expect(stop.doc.clips[1]?.sourceIn).toBe(1);
    expect(transitionAt(stop.doc, 'c1|c2')?.duration).toBe(2);
  });

  it('keeps room for the transition at the other end', () => {
    const doc = applied(shortB()); // 12 f of each clip used at the cut
    const b = trimBounds(doc, 'c1', 'start')!;
    expect(b).toMatchObject({ max: 75 - 12, maxLimit: 'other-transition' });
    expect(trimClip(doc, 'c1', 'start', 100)).toMatchObject({ limit: 'other-transition' });
  });

  it('returns the same reference when nothing changes', () => {
    const doc = shortB();
    expect(trimClip(doc, 'c1', 'end', 75).doc).toBe(doc);
  });
});

describe('a small edit session', () => {
  it('insert, split, transition on the new cut, trim and delete stay consistent', () => {
    let doc = makeDoc({ head: 15, visible: 60 }, { head: 18, visible: 60 });
    doc = insertClip(doc, SOURCES[1], 2).doc; // c1 c2 c3
    const s = splitClip(doc, 90); // inside c2
    if (!s.ok) throw new Error();
    doc = s.doc; // c1 c2 c4 c3
    const newCut = cuts(doc)[1]!;
    expect(newCut.key).toBe('c2|c4');
    const r = applyTransition(doc, newCut.key, 'wipe', { feel: 50, duration: 24 });
    if (!r.ok) throw new Error();
    doc = trimClip(r.doc, 'c4', 'end', 70).doc;
    expect(transitionAt(doc, 'c2|c4')?.duration).toBe(24);
    expect(deleteClip(doc, 'c4').transitions).toHaveLength(0);
  });
});
