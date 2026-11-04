import { describe, expect, it } from 'vitest';
import { EASING_CURVES, PRESETS } from '../config/transitions.config';
import { cubicBezier, LINEAR, lerpBezier } from './easing';
import { feelEasing, feelIntensity, feelToParams, isTuned, tuningParams } from './feel';
import { FEEL } from './fixtures';

describe('feel mapping', () => {
  it('maps the ends exactly to the snappy and smooth endpoints', () => {
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

  it('clamps out-of-range feel values', () => {
    expect(feelEasing(-20, FEEL)).toEqual(FEEL.snappy.bezier);
    expect(feelEasing(500, FEEL)).toEqual(FEEL.smooth.bezier);
  });

  it('lets Fine-tune overrides win over Feel, one at a time', () => {
    const curve = [0, 0, 1, 1] as const;
    expect(tuningParams({ feel: 0 }, FEEL)).toEqual(feelToParams(0, FEEL));
    expect(tuningParams({ feel: 0, easing: curve }, FEEL)).toEqual({ bezier: curve, intensity: 1 });
    expect(tuningParams({ feel: 0, intensity: 0.3 }, FEEL)).toEqual({ bezier: FEEL.snappy.bezier, intensity: 0.3 });
    expect(isTuned({ feel: 0 })).toBe(false);
    expect(isTuned({ feel: 0, intensity: 0 })).toBe(true);
  });

  it('gives valid curves for every configured preset', () => {
    for (const preset of PRESETS) {
      for (const b of [feelEasing(0, preset.feel), feelEasing(100, preset.feel)]) {
        expect(() => cubicBezier(b)).not.toThrow();
      }
    }
    for (const c of EASING_CURVES) expect(() => cubicBezier(c.bezier)).not.toThrow();
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
