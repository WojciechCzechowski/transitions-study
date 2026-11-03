import { clamp, lerp } from './time';

/** CSS-style cubic-bezier control points: [x1, y1, x2, y2]. */
export type Bezier = readonly [number, number, number, number];

export const LINEAR: Bezier = [0, 0, 1, 1];

/** Returns an easing function y(x) for the given control points (x1, x2 must lie in [0, 1]). */
export function cubicBezier(b: Bezier): (x: number) => number {
  const [x1, y1, x2, y2] = b;
  if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) {
    throw new RangeError(`cubic-bezier x values must be within [0, 1], got ${x1}, ${x2}`);
  }
  // Polynomial coefficients for B(t) = ((a t + b) t + c) t
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;

  const solveT = (x: number): number => {
    // Newton–Raphson first; fall back to bisection where the slope is flat.
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-7) return t;
      const d = slopeX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 40; i++) {
      const v = sampleX(t);
      if (Math.abs(v - x) < 1e-7) return t;
      if (v < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  };

  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    return sampleY(solveT(x));
  };
}

/** Interpolate two curves' control points. */
export function lerpBezier(a: Bezier, b: Bezier, t: number): Bezier {
  const k = clamp(t, 0, 1);
  return [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k), lerp(a[3], b[3], k)];
}

export function formatBezier(b: Bezier): string {
  return `cubic-bezier(${b.map((v) => v.toFixed(2)).join(', ')})`;
}
