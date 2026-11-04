import { formatDuration, formatSeconds, type Frames } from './time';
import type { Cut, Limits, Room } from './timeline';

const frames = (n: Frames) => `${n} frame${n === 1 ? '' : 's'}`;

/**
 * Why the duration cannot grow further, e.g. for the drag tooltip at the limit.
 * Short handles are trimmed to make room, so only a clip's length stops it.
 */
export function describeLimit(cut: Cut, limits: Limits): string {
  const max = `Max ${limits.max} f (${formatSeconds(limits.max)})`;
  const { aTail, bHead, aLength, bLength } = limits.available;
  const side = (label: string, length: Frames, handle: Frames, where: string) =>
    `${label} has only ${frames(length)} of length to spare` +
    (handle > 0 && handle < length ? ` and ${frames(handle)} ${where}` : '');
  return limits.limitedBy === 'a-length'
    ? `${max}: ${side(cut.from.label, aLength, aTail, 'after its out point')}`
    : `${max}: ${side(cut.to.label, bLength, bHead, 'before its in point')}`;
}

/** Short form for the minimum bound. */
export function describeMinimum(limits: Limits): string {
  return `Min ${formatDuration(limits.min)}: one frame on each side of the cut`;
}

/** Why no centred transition can be added at all: a clip is too short to give up even one frame. */
export function describeNoHandles(cut: Cut, limits: Limits): string {
  const { aLength, bLength } = limits.available;
  const short: string[] = [];
  if (limits.limitedBy === 'a-length' || aLength < 2) short.push(`${cut.from.label} has only ${frames(Math.max(0, aLength))} of length to spare`);
  if (limits.limitedBy === 'b-length' || bLength < 2) short.push(`${cut.to.label} has only ${frames(Math.max(0, bLength))} of length to spare`);
  const lead = short.join(' and ');
  return (
    `${lead}. A centred transition needs at least 1 frame of each clip on its side of the cut, ` +
    'and 1 past the cut that a clip without handle gives up by being trimmed.'
  );
}

/** "Clip A by 12 f and Clip B by 6 f": what making room trims, or '' when nothing. */
export function describeRoom(cut: Cut, room: Room): string {
  const parts: string[] = [];
  if (room.a > 0) parts.push(`${cut.from.label} by ${room.a} f`);
  if (room.b > 0) parts.push(`${cut.to.label} by ${room.b} f`);
  return parts.join(' and ');
}

/** Sentence for an announcement after an edit made room, or '' when nothing was trimmed. */
export function describeTrim(cut: Cut, room: Room): string {
  const what = describeRoom(cut, room);
  return what ? `Trimmed ${what} to make room.` : '';
}
