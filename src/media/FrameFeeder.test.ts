import { describe, expect, it } from 'vitest';
import { FrameFeeder, type GopSource } from './FrameFeeder';
import { FrameStore, type Closable } from './FrameStore';

class Fake implements Closable {
  closed = false;
  constructor(readonly name: string) {}
  close() {
    this.closed = true;
  }
}

/** A source with GOPs of 10 frames whose decodes finish only when the test says so. */
class FakeSource implements GopSource<Fake> {
  readonly width = 2;
  readonly height = 2;
  readonly calls: number[] = [];
  readonly emitted: Fake[] = [];
  private pending: (() => void)[] = [];
  constructor(
    readonly sourceId: string,
    private readonly frames = 100,
    private readonly skip?: number,
  ) {}
  gopOf(frame: number) {
    return Math.floor(frame / 10);
  }
  decodeGop(gop: number, emit: (frame: number, bitmap: Fake) => void) {
    this.calls.push(gop);
    return new Promise<void>((resolve) => {
      this.pending.push(() => {
        for (let f = gop * 10; f < Math.min(this.frames, gop * 10 + 10); f++) {
          if (f === this.skip) continue;
          const b = new Fake(`${this.sourceId}${f}`);
          this.emitted.push(b);
          emit(f, b);
        }
        resolve();
      });
    });
  }
  /** Finish the oldest decode in flight. */
  finish() {
    this.pending.shift()?.();
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(budget = Infinity, skip?: number) {
  const store = new FrameStore<Fake>(budget);
  const a = new FakeSource('a', 100, skip);
  const b = new FakeSource('b');
  const errors: unknown[] = [];
  let arrivals = 0;
  const feeder = new FrameFeeder(store, new Map<string, GopSource<Fake>>([['a', a], ['b', b]]), () => arrivals++, (_s, e) => errors.push(e));
  return { store, a, b, feeder, errors, arrivals: () => arrivals };
}

describe('FrameFeeder', () => {
  it('decodes the GOP of the most urgent missing frame, one per source, sources in parallel', async () => {
    const { a, b, feeder, store } = setup();
    feeder.setDemand([
      { sourceId: 'a', frame: 25 },
      { sourceId: 'b', frame: 3 },
      { sourceId: 'a', frame: 31 },
    ]);
    expect(a.calls).toEqual([2]);
    expect(b.calls).toEqual([0]);
    expect([...feeder.inFlight].sort()).toEqual(['a', 'b']);

    a.finish();
    await tick();
    expect(store.has('a', 25)).toBe(true);
    expect(a.calls).toEqual([2, 3]); // then the next missing frame of the same source
  });

  it('keeps the rest of a decoded group while it fits, so playback does not decode it again', async () => {
    const { a, feeder, store, arrivals } = setup();
    feeder.setDemand([{ sourceId: 'a', frame: 4 }]);
    a.finish();
    await tick();
    expect(store.size).toBe(10);
    expect(arrivals()).toBe(1);
    feeder.setDemand([{ sourceId: 'a', frame: 4 }, { sourceId: 'a', frame: 5 }]);
    expect(a.calls).toEqual([0]); // frame 5 is already there
  });

  it('evicts the unrequested part of a group first when over budget', async () => {
    const { a, feeder, store } = setup(16 * 3);
    feeder.setDemand([{ sourceId: 'a', frame: 4 }]);
    a.finish();
    await tick();
    expect(store.has('a', 4)).toBe(true);
    expect(store.bytes).toBeLessThanOrEqual(48);
    expect(a.emitted.filter((x) => x.closed)).toHaveLength(7);
  });

  it('does not decode frames already in the store', () => {
    const { a, feeder, store } = setup();
    store.setWanted([{ sourceId: 'a', frame: 4 }]);
    store.put('a', 4, new Fake('cached'), 2, 2);
    feeder.setDemand([{ sourceId: 'a', frame: 4 }]);
    expect(a.calls).toEqual([]);
  });

  it('keeps memory within budget as demand moves on', async () => {
    const { a, feeder, store } = setup(16 * 3); // three 2×2 frames
    feeder.setDemand([0, 1, 2].map((frame) => ({ sourceId: 'a', frame })));
    a.finish();
    await tick();
    feeder.setDemand([12, 13, 14].map((frame) => ({ sourceId: 'a', frame })));
    a.finish();
    await tick();
    expect(store.bytes).toBe(48);
    expect([0, 12, 13, 14].map((f) => store.has('a', f))).toEqual([false, true, true, true]);
  });

  it('decodes posters after the preview demand and closes them after drawing', async () => {
    const { a, feeder } = setup();
    const drawn: Fake[] = [];
    feeder.setDemand([{ sourceId: 'a', frame: 5 }]);
    feeder.requestPoster('a', 50, (bm) => drawn.push(bm));
    expect(a.calls).toEqual([0]);
    a.finish();
    await tick();
    expect(a.calls).toEqual([0, 5]);
    a.finish();
    await tick();
    expect(drawn.map((d) => d.name)).toEqual(['a50']);
    expect(drawn[0]!.closed).toBe(true);
  });

  it('reports a decoder that never produces the requested frame instead of retrying forever', async () => {
    const { a, feeder, errors } = setup(Infinity, 7);
    feeder.setDemand([{ sourceId: 'a', frame: 7 }]);
    a.finish();
    await tick();
    expect(errors).toHaveLength(1);
    feeder.setDemand([{ sourceId: 'a', frame: 7 }]);
    expect(a.calls).toEqual([0]);
  });

  it('closes late frames after dispose', async () => {
    const { a, feeder, store } = setup();
    feeder.setDemand([{ sourceId: 'a', frame: 1 }]);
    feeder.dispose();
    a.finish();
    await tick();
    expect(store.size).toBe(0);
    expect(a.emitted.every((x) => x.closed)).toBe(true);
  });
});
