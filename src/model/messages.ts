import { formatDuration, formatSeconds, type Frames } from './time';
import type { Cut, Limits } from './timeline';

const frames = (n: Frames) => `${n} frame${n === 1 ? '' : 's'}`;

/** Why the duration cannot grow further, e.g. for the drag tooltip at the limit. */
export function describeLimit(cut: Cut, limits: Limits): string {
  const max = `Max ${limits.max} f (${formatSeconds(limits.max)})`;
  const { available } = limits;
  const a = cut.from.label;
  const b = cut.to.label;
  switch (limits.limitedBy) {
    case 'a-tail':
      return `${max}: ${a} has only ${frames(available.aTail)} after its out point`;
    case 'b-head':
      return `${max}: ${b} has only ${frames(available.bHead)} before its in point`;
    case 'a-length':
      return `${max}: ${a} has only ${frames(available.aLength)} of length to spare`;
    case 'b-length':
      return `${max}: ${b} has only ${frames(available.bLength)} of length to spare`;
  }
}

/** Short form for the minimum bound. */
export function describeMinimum(limits: Limits): string {
  return `Min ${formatDuration(limits.min)}: one frame on each side of the cut`;
}

/** Why no centred transition can be added at all. */
export function describeNoHandles(cut: Cut, limits: Limits): string {
  const { aTail, bHead, aLength, bLength } = limits.available;
  const a = cut.from.label;
  const b = cut.to.label;
  const missing: string[] = [];
  if (aTail < 1) missing.push(`${a} has 0 frames after its out point`);
  if (bHead < 1) missing.push(`${b} has 0 frames before its in point`);
  if (aTail >= 1 && bHead >= 1 && (aLength < 1 || bLength < 1)) missing.push('a neighbouring transition uses the whole clip');
  const lead = missing.length ? missing.join(' and ') : 'There are not enough frames around the cut';
  const first = lead.charAt(0).toUpperCase() + lead.slice(1);
  return (
    `${first}. A centred transition needs at least 1 frame of handle on each side of the cut. ` +
    `Available: ${a} ${aTail} f after its out point, ${b} ${bHead} f before its in point.`
  );
}

/** Explains a Feel duration that was cut short by the handles. */
export function describeFeelClamp(cut: Cut, limits: Limits, requested: Frames): string {
  return `Feel asks for ${requested} f; ${describeLimit(cut, limits).replace(/^Max/, 'capped at')}.`;
}
