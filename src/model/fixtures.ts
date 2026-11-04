// Test fixtures (imported only by *.test.ts).
import type { FeelDefinition } from './feel';
import { createDoc, cuts, getLimits, type ClipLayout, type Cut, type Doc, type Limits, type Source } from './timeline';

export const SOURCES: readonly [Source, Source] = [
  { id: 'a', label: 'Clip A', file: 'clip-a.mp4', frames: 120 },
  { id: 'b', label: 'Clip B', file: 'clip-b.mp4', frames: 120 },
];

export function makeDoc(...layout: ClipLayout[]): Doc {
  const sources = layout.map((_, i) => SOURCES[i % 2]!);
  const r = createDoc(sources, layout);
  if (!r.ok) throw new Error('fixture layout does not fit');
  return r.doc;
}

/** The starting timeline: A tail 45 f, B head 18 f → fits 36 f untrimmed. */
export const shortB = () => makeDoc({ head: 15, visible: 60 }, { head: 18, visible: 60 });
export const generous = () => makeDoc({ head: 15, visible: 60 }, { head: 45, visible: 60 });
export const noHandleB = () => makeDoc({ head: 15, visible: 60 }, { head: 0, visible: 60 });
/** B is a single frame with no handle: nothing to trim into one, so no transition fits. */
export const tooShortB = () => makeDoc({ head: 15, visible: 60 }, { head: 0, visible: 1 });

/** The n-th cut of a document (throws if missing). */
export function cutAt(doc: Doc, n = 0): Cut {
  const c = cuts(doc)[n];
  if (!c) throw new Error(`no cut ${n}`);
  return c;
}

export const limitsAt = (doc: Doc, n = 0): Limits => getLimits(doc, cutAt(doc, n));

export const FEEL: FeelDefinition = {
  snappy: { bezier: [0.22, 1, 0.36, 1], intensity: 1 },
  smooth: { bezier: [0.45, 0, 0.55, 1], intensity: 0.2 },
};
