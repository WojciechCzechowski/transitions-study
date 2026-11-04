import { describe, expect, it } from 'vitest';
import { FrameStore, type Closable } from './FrameStore';

class Fake implements Closable {
  closed = false;
  constructor(readonly name: string) {}
  close() {
    this.closed = true;
  }
}

describe('FrameStore', () => {
  it('accounts bytes and closes evicted bitmaps', () => {
    const s = new FrameStore<Fake>();
    const a = new Fake('a10');
    s.put('a', 10, a, 4, 2);
    s.put('a', 11, new Fake('a11'), 4, 2);
    expect(s.bytes).toBe(64);
    s.retain((_c, f) => f !== 10);
    expect(a.closed).toBe(true);
    expect(s.bytes).toBe(32);
    expect(s.size).toBe(1);
  });

  it('replacing a frame closes the old bitmap', () => {
    const s = new FrameStore<Fake>();
    const old = new Fake('old');
    s.put('a', 1, old, 2, 2);
    s.put('a', 1, new Fake('new'), 2, 2);
    expect(old.closed).toBe(true);
    expect(s.bytes).toBe(16);
  });

  it('falls back to the nearest decoded frame and says so', () => {
    const s = new FrameStore<Fake>();
    s.put('b', 5, new Fake('b5'), 2, 2);
    s.put('b', 9, new Fake('b9'), 2, 2);
    expect(s.get('b', 5)).toMatchObject({ frame: 5, exact: true });
    expect(s.get('b', 8)).toMatchObject({ frame: 9, exact: false });
    expect(s.get('c', 1)).toBeNull();
  });

  it('evicts unwanted frames, least recently wanted first, to stay in budget', () => {
    // Each 2×2 frame is 16 bytes; the budget holds three.
    const s = new FrameStore<Fake>(48);
    const f = [0, 1, 2].map((i) => new Fake(`a${i}`));
    s.setWanted([{ sourceId: 'a', frame: 0 }, { sourceId: 'a', frame: 1 }, { sourceId: 'a', frame: 2 }]);
    f.forEach((b, i) => s.put('a', i, b, 2, 2));
    s.setWanted([{ sourceId: 'a', frame: 1 }]); // 0 and 2 are now unwanted, both last wanted at the same time
    s.setWanted([{ sourceId: 'a', frame: 2 }, { sourceId: 'a', frame: 3 }]); // 2 wanted again; 0 and 1 are older
    s.put('a', 3, new Fake('a3'), 2, 2);
    expect(f[0]!.closed).toBe(true);
    expect(f[1]!.closed).toBe(false);
    expect(s.bytes).toBe(48);
    expect([0, 1, 2, 3].map((i) => s.has('a', i))).toEqual([false, true, true, true]);
  });

  it('never evicts wanted frames, even over budget', () => {
    const s = new FrameStore<Fake>(16);
    s.setWanted([{ sourceId: 'a', frame: 0 }, { sourceId: 'a', frame: 1 }]);
    s.put('a', 0, new Fake('a0'), 2, 2);
    s.put('a', 1, new Fake('a1'), 2, 2);
    expect(s.size).toBe(2);
    expect(s.isWanted('a', 1)).toBe(true);
    s.setWanted([{ sourceId: 'a', frame: 1 }]);
    expect(s.has('a', 0)).toBe(false);
    expect(s.size).toBe(1);
  });

  it('matches dimensions when asked', () => {
    const s = new FrameStore<Fake>();
    s.put('a', 0, new Fake('x'), 8, 4);
    expect(s.has('a', 0)).toBe(true);
    expect(s.has('a', 0, 8, 4)).toBe(true);
    expect(s.has('a', 0, 4, 2)).toBe(false);
  });
});
