/**
 * Study harness settings: where clips come from, how much of each source is
 * visible (leaving head/tail handles), and the decode budget.
 */
import type { ClipLayout } from '../model/timeline';

export const CLIPS_BASE_URL = '/clips/';
export const MANIFEST_URL = `${CLIPS_BASE_URL}manifest.json`;

export interface Scenario {
  readonly id: string;
  readonly label: string;
  /** Layout for clip A then clip B. Tail handle = source frames − head − visible. */
  readonly layout: readonly [ClipLayout, ClipLayout];
}

/** With 120-frame sources. The first scenario is the default. */
export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'short-b',
    label: 'Short handle on B (18 f)',
    layout: [
      { head: 15, visible: 60 }, // A: 15 head, 45 tail
      { head: 18, visible: 60 }, // B: 18 head, 42 tail → max centred 36 f
    ],
  },
  {
    id: 'generous',
    label: 'Generous handles',
    layout: [
      { head: 15, visible: 60 }, // A: 45 tail
      { head: 45, visible: 60 }, // B: 45 head → max centred 90 f
    ],
  },
  {
    id: 'no-handle-b',
    label: 'No handle on B',
    layout: [
      { head: 15, visible: 60 },
      { head: 0, visible: 60 }, // B starts on its first frame → no centred transition
    ],
  },
];

export const DECODE = {
  /** Upper bound for pre-decoded ImageBitmaps, estimated as width × height × 4. */
  capBytes: 256 * 1024 * 1024,
  /** Decode size may shrink to this fraction of the source before frames are dropped. */
  minScale: 0.5,
  /** Give up on a single seek after this long. */
  seekTimeoutMs: 5000,
  /** Give up waiting for a clip's metadata after this long. */
  loadTimeoutMs: 15000,
} as const;
