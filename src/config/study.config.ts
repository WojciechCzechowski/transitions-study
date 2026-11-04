/**
 * Study harness settings: where clips come from, the starting timeline and
 * the decoded-frame cache.
 */
import type { ClipLayout } from '../model/timeline';

/**
 * Where the manifest and clips are served from. Defaults to `public/clips`
 * on the same origin; set `VITE_CLIPS_BASE_URL` at build time to load them
 * from elsewhere (for example an R2 bucket, which must allow CORS).
 */
const clipsBase = import.meta.env.VITE_CLIPS_BASE_URL?.trim() || '/clips/';
export const CLIPS_BASE_URL = clipsBase.endsWith('/') ? clipsBase : `${clipsBase}/`;
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

/**
 * Timeline filmstrip thumbnails: one per keyframe at most (each decodes on
 * its own), kept separately from the preview cache. 224×126 is sharp at 2×
 * on a 70 px tall tile; 48 MB holds about 420, roughly 140 s of footage.
 */
export const THUMBS = {
  width: 224,
  height: 126,
  cacheBytes: 48 * 1024 * 1024,
} as const;
