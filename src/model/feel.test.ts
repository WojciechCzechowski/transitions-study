import { describe, expect, it } from 'vitest';
import { PRESETS } from '../config/transitions.config';
import { cubicBezier, LINEAR, lerpBezier } from './easing';
import { feelDuration, feelEasing, feelIntensity, feelToParams } from './feel';
import { FEEL, generous, shortB } from './fixtures';
import { getLimits } from './timeline';

describe('feel mapping', () => {
  it('maps the ends exactly to the snappy and smooth endpoints', () => {
    expect(feelDuration(0, FEEL)).toBe(8);
    expect(feelDuration(100, FEEL)).toBe(40);
    expect(feelEasing(0, FEEL)).toEqual(FEEL.snappy.bezier);
    expect(feelEasing(100, FEEL)).toEqual(FEEL.smooth.bezier);
    expect(feelIntensity(0, FEEL)).toBe(1);
    expect(feelIntensity(100, FEEL)).toBeCloseTo(0.2);
  });

  it('interpolates easing and intensity in between', () => {
    const mid = feelEasing(50, FEEL);
    expect(mid[0]).toBeCloseTo((0.22 + 0.45) / 2);
    expect(mid[1]).toBeCloseTo((1 + 0) / 2);
    expect(feelIntensity(50, FEEL)).toBeCloseTo(0.6);
  });

  it('produces even, monotonic durations across the slider', () => {
    let prev = -Infinity;
    for (let f = 0; f <= 100; f++) {
      const d = feelDuration(f, FEEL);
      expect(d % 2).toBe(0);
      expect(d).toBeGreaterThanOrEqual(prev);
      prev = d;
    }
  });

  it('clamps out-of-range feel values', () => {
    expect(feelDuration(-20, FEEL)).toBe(8);
    expect(feelDuration(500, FEEL)).toBe(40);
  });

  it('clamps duration to the handles and flags it', () => {
    const p = feelToParams(100, FEEL, getLimits(shortB()));
    expect(p.requested).toBe(40);
    expect(p.duration).toBe(36);
    expect(p.clamped).toBe('max');
    // Easing and intensity are unaffected by the duration clamp.
    expect(p.bezier).toEqual(FEEL.smooth.bezier);
  });

  it('does not flag when the handles are long enough', () => {
    const p = feelToParams(100, FEEL, getLimits(generous()));
    expect(p).toMatchObject({ duration: 40, clamped: null });
  });

  it('works with every configured preset', () => {
    const limits = getLimits(generous());
    for (const preset of PRESETS) {
      const snappy = feelToParams(0, preset.feel, limits);
      const smooth = feelToParams(100, preset.feel, limits);
      expect(snappy.duration).toBeLessThan(smooth.duration);
      expect(snappy.duration % 2).toBe(0);
      expect(smooth.duration % 2).toBe(0);
      for (const b of [snappy.bezier, smooth.bezier]) {
        expect(() => cubicBezier(b)).not.toThrow();
      }
    }
  });
});

describe('cubicBezier', () => {
  it('pins the endpoints', () => {
    const ease = cubicBezier(FEEL.snappy.bezier);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
  });

  it('is the identity for the linear curve', () => {
    const ease = cubicBezier(LINEAR);
    for (const x of [0.1, 0.25, 0.5, 0.9]) expect(ease(x)).toBeCloseTo(x, 5);
  });

  it('matches the CSS ease-in-out midpoint symmetry', () => {
    const ease = cubicBezier([0.42, 0, 0.58, 1]);
    expect(ease(0.5)).toBeCloseTo(0.5, 5);
    expect(ease(0.25) + ease(0.75)).toBeCloseTo(1, 5);
  });

  it('is monotonic for the configured curves', () => {
    for (const b of [FEEL.snappy.bezier, FEEL.smooth.bezier, lerpBezier(FEEL.snappy.bezier, FEEL.smooth.bezier, 0.5)]) {
      const ease = cubicBezier(b);
      let prev = 0;
      for (let i = 1; i <= 100; i++) {
        const y = ease(i / 100);
        expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = y;
      }
    }
  });

  it('rejects x control points outside [0, 1]', () => {
    expect(() => cubicBezier([1.2, 0, 0.5, 1])).toThrow(RangeError);
  });
});
