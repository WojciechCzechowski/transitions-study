import { describe, expect, it } from 'vitest';
import { frameBytes, planDecode, type DecodePlanInput } from './decodePlan';
import { noHandleB, shortB } from './fixtures';
import { cycleLength, loopFrameAt, loopRange, onceFrameAt, rebaseElapsed } from './previewLoop';

const base = (over: Partial<DecodePlanInput> = {}): DecodePlanInput => ({
  doc: shortB(),
  leadIn: 12,
  tail: 12,
  sourceWidth: 960,
  sourceHeight: 540,
  capBytes: 1e12,
  minScale: 0.5,
  ...over,
});

describe('planDecode', () => {
  it('covers both visible ranges plus the handle frames a max transition uses', () => {
    const p = planDecode(base());
    expect(p.a).toMatchObject({ clipId: 'a', start: 15, end: 93 });
    expect(p.b).toMatchObject({ clipId: 'b', start: 0, end: 78 });
    expect(p.frameCount).toBe(156);
    expect(p).toMatchObject({ scale: 1, width: 960, height: 540, trimmed: false, overCap: false });
  });

  it('shrinks the decode size to respect the memory cap', () => {
    const cap = 256 * 1024 * 1024;
    const p = planDecode(base({ capBytes: cap }));
    expect(p.frameCount).toBe(156);
    expect(p.scale).toBeLessThan(1);
    expect(p.scale).toBeGreaterThanOrEqual(0.5);
    expect(p.bytes).toBeLessThanOrEqual(cap);
    expect(p.width % 2).toBe(0);
    expect(p.height % 2).toBe(0);
  });

  it('trims frames far from the cut once the minimum scale is reached, keeping the reach', () => {
    const perFrame = frameBytes(480, 270);
    const p = planDecode(base({ capBytes: perFrame * 120 }));
    expect(p.scale).toBe(0.5);
    expect(p.trimmed).toBe(true);
    expect(p.frameCount).toBe(120);
    // Reach: preview loop [30, 90) on the timeline → A src [45, 93), B src [0, 48).
    expect(p.a.start).toBeLessThanOrEqual(45);
    expect(p.a.end).toBe(93);
    expect(p.b.start).toBe(0);
    expect(p.b.end).toBeGreaterThanOrEqual(48);
    expect(p.bytes).toBeLessThanOrEqual(perFrame * 120);
  });

  it('never drops the reach, flagging when it alone exceeds the cap', () => {
    const p = planDecode(base({ capBytes: frameBytes(480, 270) * 10 }));
    expect(p.overCap).toBe(true);
    expect(p.a).toMatchObject({ start: 45, end: 93 });
    expect(p.b).toMatchObject({ start: 0, end: 48 });
  });

  it('needs no handle frames when no transition is possible', () => {
    const p = planDecode(base({ doc: noHandleB() }));
    expect(p.a).toMatchObject({ start: 15, end: 75 });
    expect(p.b).toMatchObject({ start: 0, end: 60 });
  });
});

describe('preview loop', () => {
  const r = loopRange(60, 24, 12, 12, 10, 120);

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
    const longer = loopRange(60, 36, 12, 12, 10, 120); // [30, 90)
    expect(loopFrameAt(longer, rebaseElapsed(70, longer))).toBe(70);
    const shorter = loopRange(60, 8, 12, 12, 10, 120); // [44, 76)
    expect(rebaseElapsed(80, shorter)).toBe(0);
  });

  it('clamps to the timeline', () => {
    expect(loopRange(10, 40, 12, 12, 0, 120).start).toBe(0);
    expect(loopRange(110, 40, 12, 12, 0, 120).end).toBe(120);
  });
});
