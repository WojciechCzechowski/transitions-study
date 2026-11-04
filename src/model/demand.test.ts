import { describe, expect, it } from 'vitest';
import { wantedFrames, type DemandOptions } from './demand';
import { cutAt, shortB } from './fixtures';
import { applyTransition } from './ops';

// shortB: timeline 0–59 shows A source 15–74, timeline 60–119 shows B source 18–77.
const opts = (over: Partial<DemandOptions> = {}): DemandOptions => ({
  lookahead: 3,
  scrubAhead: 2,
  scrubBehind: 1,
  maxFrames: 100,
  ...over,
});
const keys = (refs: { sourceId: string; frame: number }[]) => refs.map((r) => `${r.sourceId}:${r.frame}`);

describe('wantedFrames', () => {
  it('asks for the playhead first, then a few frames ahead, then behind', () => {
    expect(keys(wantedFrames(shortB(), { kind: 'idle', playhead: 10 }, opts()))).toEqual(['a:25', 'a:26', 'a:27', 'a:24']);
  });

  it('looks ahead across a cut while playing', () => {
    expect(keys(wantedFrames(shortB(), { kind: 'playing', playhead: 58 }, opts()))).toEqual(['a:73', 'a:74', 'b:18', 'b:19']);
  });

  it('needs both sides inside a transition', () => {
    const doc = shortB();
    const r = applyTransition(doc, cutAt(doc).key, 'crossDissolve', { feel: 50, duration: 24 });
    if (!r.ok) throw new Error('fixture');
    // Transition spans timeline 48–71; at 50 A shows 65 and B shows 8.
    const w = wantedFrames(r.doc, { kind: 'idle', playhead: 50 }, opts({ scrubAhead: 0, scrubBehind: 0 }));
    expect(keys(w)).toEqual(['a:65', 'b:8']);
  });

  it('covers a preview loop from the current frame, wrapping to its start', () => {
    const w = wantedFrames(shortB(), { kind: 'preview', frame: 42, range: { start: 40, end: 44, hold: 5 } }, opts());
    expect(keys(w)).toEqual(['a:57', 'a:58', 'a:55', 'a:56']);
  });

  it('stays inside the timeline and the budget', () => {
    expect(keys(wantedFrames(shortB(), { kind: 'playing', playhead: 118 }, opts()))).toEqual(['b:76', 'b:77']);
    expect(wantedFrames(shortB(), { kind: 'playing', playhead: 0 }, opts({ lookahead: 50, maxFrames: 3 }))).toHaveLength(3);
    expect(wantedFrames(shortB(), { kind: 'idle', playhead: 0 }, opts({ maxFrames: 0 }))).toEqual([]);
  });
});
