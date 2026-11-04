import { describe, expect, it } from 'vitest';
import { frameBytes, planLibraryDecode, type LibraryDecodeInput } from './decodePlan';
import { cycleLength, loopFrameAt, loopRange, onceFrameAt, rebaseElapsed } from './previewLoop';

const base = (over: Partial<LibraryDecodeInput> = {}): LibraryDecodeInput => ({
  sources: [
    { id: 'a', frames: 120 },
    { id: 'b', frames: 120 },
  ],
  sourceWidth: 960,
  sourceHeight: 540,
  capBytes: 1e12,
  minScale: 0.5,
  ...over,
});

describe('planLibraryDecode', () => {
  it('covers every frame of every source', () => {
    const p = planLibraryDecode(base());
    expect(p.ranges).toEqual([
      { sourceId: 'a', start: 0, end: 120 },
      { sourceId: 'b', start: 0, end: 120 },
    ]);
    expect(p.frameCount).toBe(240);
    expect(p).toMatchObject({ scale: 1, width: 960, height: 540, overCap: false });
  });

  it('shrinks the decode size to respect the memory cap', () => {
    const cap = 400 * 1024 * 1024;
    const p = planLibraryDecode(base({ capBytes: cap }));
    expect(p.frameCount).toBe(240);
    expect(p.scale).toBeLessThan(1);
    expect(p.scale).toBeGreaterThan(0.85);
    expect(p.bytes).toBeLessThanOrEqual(cap);
    expect(p.width % 2).toBe(0);
    expect(p.height % 2).toBe(0);
  });

  it('keeps every frame at the minimum scale when even that exceeds the cap', () => {
    const p = planLibraryDecode(base({ capBytes: frameBytes(480, 270) * 100 }));
    expect(p).toMatchObject({ scale: 0.5, width: 480, height: 270, frameCount: 240, overCap: true });
  });
});

const ALL = { start: 0, end: 120 };

describe('preview loop', () => {
  const r = loopRange(60, 24, 12, 12, 10, ALL);

  it('spans the transition plus lead-in and tail', () => {
    expect(r).toEqual({ start: 36, end: 84, hold: 10 });
    expect(cycleLength(r)).toBe(58);
  });

  it('loops, holding the last frame before restarting', () => {
    expect(loopFrameAt(r, 0)).toBe(36);
    expect(loopFrameAt(r, 47)).toBe(83);
    expect(loopFrameAt(r, 50)).toBe(83);
    expect(loopFrameAt(r, 58)).toBe(36);
    expect(loopFrameAt(r, 58 * 3 + 5)).toBe(41);
  });

  it('plays once and stops on the last frame', () => {
    expect(onceFrameAt(r, 0)).toEqual({ frame: 36, done: false });
    expect(onceFrameAt(r, 47)).toEqual({ frame: 83, done: true });
    expect(onceFrameAt(r, 400)).toEqual({ frame: 83, done: true });
  });

  it('keeps the same timeline frame when switching to a preset with another duration', () => {
    const longer = loopRange(60, 36, 12, 12, 10, ALL); // [30, 90)
    expect(loopFrameAt(longer, rebaseElapsed(70, longer))).toBe(70);
    const shorter = loopRange(60, 8, 12, 12, 10, ALL); // [44, 76)
    expect(rebaseElapsed(80, shorter)).toBe(0);
  });

  it('clamps to the two clips at the cut', () => {
    expect(loopRange(10, 40, 12, 12, 0, ALL).start).toBe(0);
    expect(loopRange(110, 40, 12, 12, 0, ALL).end).toBe(120);
    expect(loopRange(100, 20, 12, 12, 0, { start: 80, end: 130 })).toEqual({ start: 80, end: 122, hold: 0 });
  });
});
