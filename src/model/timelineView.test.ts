import { describe, expect, it } from 'vitest';
import { cutAt, makeDoc } from './fixtures';
import { applyTransition } from './ops';
import {
  boundaryFrame,
  clampZoom,
  cutAtFrame,
  fitScale,
  insertionIndex,
  rulerLabel,
  sliderToZoom,
  tickStep,
  ZOOM,
  zoomToSlider,
} from './timelineView';

describe('cutAtFrame', () => {
  // Cuts at 60 and 100. Generous handles so a transition fits on the second cut.
  const doc = makeDoc({ head: 15, visible: 60 }, { head: 45, visible: 40 }, { head: 45, visible: 30 });

  it('picks the nearest cut within the tolerance', () => {
    expect(cutAtFrame(doc, 60, 5)?.key).toBe(cutAt(doc, 0).key);
    expect(cutAtFrame(doc, 64, 5)?.key).toBe(cutAt(doc, 0).key);
    expect(cutAtFrame(doc, 97, 5)?.key).toBe(cutAt(doc, 1).key);
  });

  it('returns null away from every cut', () => {
    expect(cutAtFrame(doc, 80, 5)).toBeNull();
    expect(cutAtFrame(doc, 0, 5)).toBeNull();
    expect(cutAtFrame(makeDoc({ head: 0, visible: 60 }), 60, 5)).toBeNull();
  });

  it('reaches across an existing transition', () => {
    const r = applyTransition(doc, cutAt(doc, 1).key, 'push', { feel: 0, duration: 8 });
    if (!r.ok) throw new Error('expected a transition');
    const half = r.transition.duration / 2;
    expect(cutAtFrame(r.doc, 100 - half - 4, 5)?.key).toBe(cutAt(r.doc, 1).key);
    expect(cutAtFrame(r.doc, 100 - half - 6, 5)).toBeNull();
  });
});

describe('insertionIndex', () => {
  // [0,60) [60,100) [100,130)
  const doc = makeDoc({ head: 0, visible: 60 }, { head: 0, visible: 40 }, { head: 0, visible: 30 });

  it('snaps to the nearest clip boundary', () => {
    expect(insertionIndex(doc, -50)).toBe(0);
    expect(insertionIndex(doc, 29)).toBe(0);
    expect(insertionIndex(doc, 31)).toBe(1);
    expect(insertionIndex(doc, 85)).toBe(2);
    expect(insertionIndex(doc, 125)).toBe(3);
    expect(insertionIndex(doc, 900)).toBe(3);
  });

  it('maps boundaries back to frames', () => {
    expect([0, 1, 2, 3].map((i) => boundaryFrame(doc, i))).toEqual([0, 60, 100, 130]);
  });
});

describe('ruler', () => {
  it('picks label spacing of at least 64 px', () => {
    expect(tickStep(20)).toEqual({ major: 5, minor: 1 });
    expect(tickStep(4)).toEqual({ major: 30, minor: 5 });
    expect(tickStep(1)).toEqual({ major: 150, minor: 30 });
    expect(tickStep(0.01).major).toBe(900);
  });

  it('labels seconds and frames', () => {
    expect(rulerLabel(0, 30)).toBe('0:00');
    expect(rulerLabel(150, 150)).toBe('0:05');
    expect(rulerLabel(1800, 300)).toBe('1:00');
    // Sub-second steps put frames on every label, whole seconds included.
    expect(rulerLabel(30, 10)).toBe('0:01:00');
    expect(rulerLabel(1805, 5)).toBe('1:00:05');
  });
});

describe('zoom', () => {
  it('fits and clamps', () => {
    expect(fitScale(120, 600)).toBe(5);
    expect(fitScale(0, 600)).toBe(1);
    expect(clampZoom(1000)).toBe(ZOOM.maxPxPerFrame);
  });

  it('round-trips through the slider', () => {
    expect(sliderToZoom(0)).toBeCloseTo(ZOOM.minPxPerFrame);
    expect(sliderToZoom(100)).toBeCloseTo(ZOOM.maxPxPerFrame);
    expect(zoomToSlider(sliderToZoom(40))).toBe(40);
  });
});
