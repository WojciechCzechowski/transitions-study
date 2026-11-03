import { formatDuration, formatSeconds, type Frames } from './time';
import type { Doc, Limits } from './timeline';

const frames = (n: Frames) => `${n} frame${n === 1 ? '' : 's'}`;

/** Why the duration cannot grow further, e.g. for the drag tooltip at the limit. */
export function describeLimit(doc: Doc, limits: Limits): string {
  const max = `Max ${limits.max} f (${formatSeconds(limits.max)})`;
  const { available } = limits;
  switch (limits.limitedBy) {
    case 'a-tail':
      return `${max}: ${doc.a.label} has only ${frames(available.aTail)} after its out point`;
    case 'b-head':
      return `${max}: ${doc.b.label} has only ${frames(available.bHead)} before its in point`;
    case 'a-length':
      return `${max}: ${doc.a.label} is only ${frames(available.aLength)} long`;
    case 'b-length':
      return `${max}: ${doc.b.label} is only ${frames(available.bLength)} long`;
  }
}

/** Short form for the minimum bound. */
export function describeMinimum(limits: Limits): string {
  return `Min ${formatDuration(limits.min)}: one frame on each side of the cut`;
}

/** Why no centred transition can be added at all. */
export function describeNoHandles(doc: Doc, limits: Limits): string {
  const { aTail, bHead } = limits.available;
  const missing: string[] = [];
  if (aTail < 1) missing.push(`${doc.a.label} has 0 frames after its out point`);
  if (bHead < 1) missing.push(`${doc.b.label} has 0 frames before its in point`);
  const lead = missing.length ? missing.join(' and ') : 'There are not enough frames around the cut';
  return (
    `${lead}. A centred transition needs at least 1 frame of handle on each side of the cut. ` +
    `Available: ${doc.a.label} ${aTail} f after its out point, ${doc.b.label} ${bHead} f before its in point.`
  );
}

/** Explains a Feel duration that was cut short by the handles. */
export function describeFeelClamp(doc: Doc, limits: Limits, requested: Frames): string {
  return `Feel asks for ${requested} f; ${describeLimit(doc, limits).replace(/^Max/, 'capped at')}.`;
}
