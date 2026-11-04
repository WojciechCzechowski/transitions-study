/**
 * Study harness settings: where clips come from, the starting timeline,
 * Library insert handles and the decoded-frame cache.
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

/**
 * Frames are decoded on demand (WebCodecs, one keyframe group at a time) into
 * a capped cache, so memory stays near `cacheBytes` whatever the clip length.
 */
export const DECODE = {
  /** Upper bound for decoded ImageBitmaps, estimated as width × height × 4 (about 85 frames at 1280×720). */
  cacheBytes: 320 * 1024 * 1024,
  /** Timeline frames kept decoded ahead of the playhead while playing. */
  lookahead: 45,
  /** Timeline frames kept decoded around a still playhead, for scrubbing and frame stepping. */
  scrubAhead: 10,
  scrubBehind: 5,
} as const;
