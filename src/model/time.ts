/** All times in the model are integer frames at this rate. Seconds are display-only. */
export const FPS = 30;

/** An integer number of frames. */
export type Frames = number;

export function isFrames(n: number): boolean {
  return Number.isInteger(n);
}

export function assertFrames(n: number, what = 'value'): asserts n is Frames {
  if (!Number.isInteger(n)) {
    throw new RangeError(`${what} must be an integer number of frames, got ${n}`);
  }
}

export function framesToSeconds(f: Frames): number {
  return f / FPS;
}

/** Nearest even integer; odd integers round up (3 → 4). */
export function roundToEven(n: number): Frames {
  return 2 * Math.round(n / 2);
}

/** Largest even integer ≤ n, for n ≥ 0. */
export function floorToEven(n: number): Frames {
  return 2 * Math.floor(n / 2);
}

/** "0.80 s" */
export function formatSeconds(f: Frames): string {
  return `${framesToSeconds(f).toFixed(2)} s`;
}

/** "24 f · 0.80 s" */
export function formatDuration(f: Frames): string {
  return `${f} f · ${formatSeconds(f)}`;
}

/** "00:02:14" — minutes : seconds : frames. */
export function formatTimecode(f: Frames): string {
  const sign = f < 0 ? '-' : '';
  const abs = Math.abs(f);
  const frames = abs % FPS;
  const totalSeconds = Math.floor(abs / FPS);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${sign}${pad(minutes)}:${pad(seconds)}:${pad(frames)}`;
}

/** "0:56", "12:04" — minutes : seconds, frames dropped. For the toolbar clock and the playhead. */
export function formatClock(f: Frames): string {
  const totalSeconds = Math.floor(Math.max(0, f) / FPS);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

export function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
