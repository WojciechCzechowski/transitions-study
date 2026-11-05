import { formatDuration, formatSeconds, type Frames } from './time';
import type { Limits, Room } from './timeline';

/** "28 frames", held together (no-break space) so a wrapping tooltip or toast never splits it. */
const frames = (n: Frames) => `${n}\u00a0frame${n === 1 ? '' : 's'}`;

/**
 * The clips at a cut, by where they sit on the timeline: people rarely know clip names by heart.
 * (Editors say outgoing and incoming; left and right is what's on screen.)
 */
const LEFT = 'the left clip';
const RIGHT = 'the right clip';
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Why the duration cannot grow further, e.g. for the drag tooltip at the limit.
 * Short handles are trimmed to make room, so only a clip's length stops it.
 */
export function describeLimit(limits: Limits): string {
  const max = `Max ${limits.max} f (${formatSeconds(limits.max)})`;
  const { aTail, bHead, aLength, bLength } = limits.available;
  const side = (label: string, length: Frames, handle: Frames, where: string) =>
    `${label} has only ${frames(length)} of length to spare` +
    (handle > 0 && handle < length ? ` and ${frames(handle)} ${where}` : '');
  return limits.limitedBy === 'a-length'
    ? `${max}: ${side(LEFT, aLength, aTail, 'after its out point')}`
    : `${max}: ${side(RIGHT, bLength, bHead, 'before its in point')}`;
}

/** Short form for the minimum bound. */
export function describeMinimum(limits: Limits): string {
  return `Min ${formatDuration(limits.min)}: one frame on each side of the cut`;
}

/** Why no centred transition can be added at all: a clip is too short to give up even one frame. */
export function describeNoHandles(limits: Limits): string {
  const { aLength, bLength } = limits.available;
  const short: string[] = [];
  if (limits.limitedBy === 'a-length' || aLength < 2) short.push(`${LEFT} has only ${frames(Math.max(0, aLength))} of length to spare`);
  if (limits.limitedBy === 'b-length' || bLength < 2) short.push(`${RIGHT} has only ${frames(Math.max(0, bLength))} of length to spare`);
  const lead = capital(short.join(' and '));
  return (
    `${lead}. A centred transition needs at least 1 frame of each clip on its side of the cut, ` +
    'and 1 past the cut that a clip without handle gives up by being trimmed.'
  );
}

/** "left clip by 12 f and right clip by 6 f": what making room trims, compact for a drag label, or '' when nothing. */
export function describeRoom(room: Room): string {
  const parts: string[] = [];
  if (room.a > 0) parts.push(`left clip by ${room.a} f`);
  if (room.b > 0) parts.push(`right clip by ${room.b} f`);
  return parts.join(' and ');
}

/** What one side had past the cut: "no footage before its start", "only 12 frames of footage after its end". */
const had = (handle: Frames, where: string) => (handle > 0 ? `only ${frames(handle)} of footage ${where}` : `no footage ${where}`);

/**
 * One plain sentence on what making room trimmed and why, in frames. A centred transition
 * of `duration` needs half its length past the cut on each side; the trim is what a handle
 * lacked, so that handle was `half − trimmed`. `lead` is "Trimmed" or "Will trim", with the
 * matching tense for why.
 */
function sayTrim(room: Room, duration: Frames, lead: string, past: boolean): string {
  const half = duration / 2;
  const a = `${frames(room.a)} from the end of ${LEFT}`;
  const b = `${frames(room.b)} from the start of ${RIGHT}`;
  const it = past ? 'it had' : 'it has';
  if (room.a > 0 && room.b > 0) return `${lead} ${a} and ${b}: ${past ? 'neither had' : 'neither has'} enough footage past the cut.`;
  if (room.b > 0) return `${lead} ${b}: ${it} ${had(half - room.b, 'before its start')}.`;
  if (room.a > 0) return `${lead} ${a}: ${it} ${had(half - room.a, 'after its end')}.`;
  return '';
}

/** Sentence for the toast and announcement after an edit to `duration` made room, or '' when nothing was trimmed. */
export function describeTrim(room: Room, duration: Frames): string {
  return sayTrim(room, duration, 'Trimmed', true);
}

/** The warning on a preset card before it's applied, e.g. "Will trim 21 frames from the start of the right clip: it has only 18 frames of …", or '' when nothing. */
export function describeTrimWarning(room: Room, duration: Frames): string {
  return sayTrim(room, duration, 'Will trim', false);
}

/**
 * The full why behind a trim a transition made, for the note on the timeline. Says left or
 * right clip, with `clip` (its name) once in the title to match it to the Library.
 * `handle` is that clip's handle at the cut now: the trimmed frames plus what it had before,
 * which is what the transition needed when it grew to its longest.
 */
export function describeTrimDetail(
  clip: string,
  side: 'a' | 'b',
  trimmed: Frames,
  handle: Frames,
  preset: string,
): { title: string; name: string; body: string; fix: string } {
  const before = Math.max(0, handle - trimmed);
  const start = side === 'b';
  const which = start ? RIGHT : LEFT;
  const where = start ? 'before its start' : 'after its end';
  return {
    title: `Trimmed ${frames(trimmed)} from the ${start ? 'start' : 'end'} of ${which}`,
    name: clip,
    body:
      `${preset} is centred on the cut, so it needed ${frames(handle)} of ${which}\u2019s footage from ${where}. ` +
      `It had ${before > 0 ? `only ${frames(before)}` : 'none'}, so its ${start ? 'first' : 'last'} ${frames(trimmed)} were trimmed to provide it.`,
    fix: `To get them back, shorten the transition, then drag the clip\u2019s ${start ? 'start' : 'end'} outward.`,
  };
}
