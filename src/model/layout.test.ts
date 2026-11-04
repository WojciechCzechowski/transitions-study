import { describe, expect, it } from 'vitest';
import {
  clampSidebar,
  clampTimeline,
  DEFAULT_SIZES,
  LAYOUT,
  parseStoredLayout,
  sidebarRange,
  sidebarView,
  stepSize,
  timelineRange,
} from './layout';

describe('pane ranges', () => {
  it('leaves room for the preview beside the sidebar', () => {
    expect(sidebarRange(1440)).toEqual({ min: 240, max: 1440 - LAYOUT.splitter - LAYOUT.previewMin });
  });

  it('keeps the minimum when the window is too small', () => {
    expect(sidebarRange(400)).toEqual({ min: 240, max: 240 });
    expect(timelineRange(300)).toEqual({ min: 180, max: 180 });
  });

  it('leaves room for the top row above the timeline', () => {
    expect(timelineRange(900).max).toBe(900 - LAYOUT.splitter - LAYOUT.topMin);
  });

  it('clamps and rounds', () => {
    expect(clampSidebar(100, 1440)).toBe(240);
    expect(clampSidebar(5000, 1440)).toBe(sidebarRange(1440).max);
    expect(clampSidebar(300.6, 1440)).toBe(301);
    expect(clampTimeline(50, 900)).toBe(180);
    expect(clampTimeline(2000, 900)).toBe(timelineRange(900).max);
  });
});

describe('stepSize', () => {
  const r = { min: 240, max: 600 };

  it('steps by 16, or 64 with Shift, in the grow direction', () => {
    expect(stepSize('ArrowRight', false, 300, r, 'ArrowRight')).toBe(316);
    expect(stepSize('ArrowLeft', false, 300, r, 'ArrowRight')).toBe(284);
    expect(stepSize('ArrowRight', true, 300, r, 'ArrowRight')).toBe(364);
    expect(stepSize('ArrowUp', false, 300, r, 'ArrowUp')).toBe(316);
    expect(stepSize('ArrowDown', true, 300, r, 'ArrowUp')).toBe(240);
  });

  it('jumps to the ends with Home/End and clamps', () => {
    expect(stepSize('Home', false, 300, r, 'ArrowRight')).toBe(240);
    expect(stepSize('End', false, 300, r, 'ArrowRight')).toBe(600);
    expect(stepSize('ArrowRight', true, 590, r, 'ArrowRight')).toBe(600);
  });

  it('ignores other keys, including the cross-axis arrows', () => {
    expect(stepSize('Enter', false, 300, r, 'ArrowRight')).toBeNull();
    expect(stepSize('ArrowUp', false, 300, r, 'ArrowRight')).toBeNull();
  });
});

describe('parseStoredLayout', () => {
  it('reads valid sizes', () => {
    expect(parseStoredLayout('{"sidebar":400,"timeline":320}')).toEqual({ sidebar: 400, timeline: 320 });
  });

  it('falls back on junk, per field', () => {
    expect(parseStoredLayout(null)).toEqual(DEFAULT_SIZES);
    expect(parseStoredLayout('not json')).toEqual(DEFAULT_SIZES);
    expect(parseStoredLayout('42')).toEqual(DEFAULT_SIZES);
    expect(parseStoredLayout('{"sidebar":"wide","timeline":-3}')).toEqual(DEFAULT_SIZES);
    expect(parseStoredLayout('{"sidebar":410}')).toEqual({ sidebar: 410, timeline: DEFAULT_SIZES.timeline });
  });
});

describe('sidebarView', () => {
  it('shows the picker without a transition', () => {
    expect(sidebarView({ hasTransition: false, selected: false, changing: false })).toBe('pick');
    expect(sidebarView({ hasTransition: false, selected: true, changing: false })).toBe('pick');
  });

  it('shows the editor only for a selected transition', () => {
    expect(sidebarView({ hasTransition: true, selected: true, changing: false })).toBe('edit');
    expect(sidebarView({ hasTransition: true, selected: false, changing: false })).toBe('pick');
  });

  it('shows the picker while swapping', () => {
    expect(sidebarView({ hasTransition: true, selected: true, changing: true })).toBe('pick');
  });
});
