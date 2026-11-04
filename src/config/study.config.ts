/**
 * Study harness settings: where clips come from, the starting timeline,
 * Library insert handles and the decode budget.
 */
import type { ClipLayout } from '../model/timeline';

export const CLIPS_BASE_URL = '/clips/';
export const MANIFEST_URL = `${CLIPS_BASE_URL}manifest.json`;

/**
 * The starting timeline: the first two library clips back to back (120-frame
 * sources). Tail handle = source frames − head − visible.
 */
export const START_LAYOUT: readonly [ClipLayout, ClipLayout] = [
  { head: 15, visible: 60 }, // A: 15 head, 45 tail
  { head: 18, visible: 60 }, // B: 18 head, 42 tail → max centred 36 f
];

/**
 * Handles left on a clip dragged in from the Library, so its cuts can take
 * transitions straight away. Shorter sources get smaller handles.
 */
export const LIBRARY_INSERT = { head: 30, tail: 30 } as const;

/** Every frame of every library clip is pre-decoded once, at the largest size that fits. */
export const DECODE = {
  /** Upper bound for pre-decoded ImageBitmaps, estimated as width × height × 4. */
  capBytes: 400 * 1024 * 1024,
  /** Decode size may shrink to this fraction of the source; past that the cap is exceeded (with a warning). */
  minScale: 0.5,
  /** Library clips decoded at the same time. */
  concurrency: 2,
  /** Give up on a single seek after this long. */
  seekTimeoutMs: 5000,
  /** Give up waiting for a clip's metadata after this long. */
  loadTimeoutMs: 15000,
} as const;
