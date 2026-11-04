import { describe, expect, it } from 'vitest';
import { makeDoc } from './fixtures';
import { boundaryFrame, clampZoom, fitScale, insertionIndex, rulerLabel, sliderToZoom, tickStep, ZOOM, zoomToSlider } from './timelineView';

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
    expect(rulerLabel(0)).toBe('0:00');
    expect(rulerLabel(150)).toBe('0:05');
    expect(rulerLabel(1805)).toBe('1:00:05');
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
