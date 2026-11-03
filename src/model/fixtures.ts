// Test fixtures (imported only by *.test.ts).
import type { FeelDefinition } from './feel';
import { createDoc, type ClipLayout, type ClipSourceInfo, type Doc } from './timeline';

export const SOURCES: readonly [ClipSourceInfo, ClipSourceInfo] = [
  { id: 'a', label: 'Clip A', file: 'clip-a.mp4', frames: 120 },
  { id: 'b', label: 'Clip B', file: 'clip-b.mp4', frames: 120 },
];

export function makeDoc(a: ClipLayout, b: ClipLayout, sources = SOURCES): Doc {
  const r = createDoc(sources, [a, b]);
  if (!r.ok) throw new Error('fixture layout does not fit');
  return r.doc;
}

/** The default study scenario: A tail 45 f, B head 18 f → max 36 f. */
export const shortB = () => makeDoc({ head: 15, visible: 60 }, { head: 18, visible: 60 });
export const generous = () => makeDoc({ head: 15, visible: 60 }, { head: 45, visible: 60 });
export const noHandleB = () => makeDoc({ head: 15, visible: 60 }, { head: 0, visible: 60 });

export const FEEL: FeelDefinition = {
  snappy: { frames: 8, bezier: [0.22, 1, 0.36, 1], intensity: 1 },
  smooth: { frames: 40, bezier: [0.45, 0, 0.55, 1], intensity: 0.2 },
};
