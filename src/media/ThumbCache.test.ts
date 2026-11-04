import { describe, expect, it } from 'vitest';
import type { Closable } from './FrameStore';
import { ThumbCache } from './ThumbCache';

class Fake implements Closable {
  closed = false;
  constructor(readonly name: string) {}
  close() {
    this.closed = true;
  }
}

/** GOPs of 10 frames; source "x" is unknown. */
function setup(budgetThumbs = 100) {
  const requests: string[] = [];
  const cache = new ThumbCache<Fake>(
    budgetThumbs * 10,
    10,
    (sourceId, frame) => (sourceId === 'x' ? null : Math.floor(frame / 10)),
    (sourceId, gop) => requests.push(`${sourceId}:${gop}`),
  );
  return { cache, requests };
}

describe('ThumbCache', () => {
  it('requests each keyframe group once', () => {
    const { cache, requests } = setup();
    cache.want('a', 3);
    cache.want('a', 7); // same group
    cache.want('a', 12);
    cache.want('x', 5); // unknown source
    expect(requests).toEqual(['a:0', 'a:1']);
    cache.put('a', 0, new Fake('a0'));
    cache.want('a', 4);
    expect(requests).toEqual(['a:0', 'a:1']);
  });

  it('shows the exact group, else the nearest one of the same source', () => {
    const { cache } = setup();
    expect(cache.get('a', 0)).toBeNull();
    cache.put('a', 0, new Fake('a0'));
    cache.put('a', 5, new Fake('a5'));
    expect(cache.get('a', 52)?.name).toBe('a5');
    expect(cache.get('a', 21)?.name).toBe('a0');
    expect(cache.get('b', 0)).toBeNull();
  });

  it('notifies subscribers when a thumbnail arrives', () => {
    const { cache } = setup();
    let calls = 0;
    const off = cache.subscribe(() => calls++);
    const v = cache.getVersion();
    cache.put('a', 1, new Fake('a1'));
    expect(calls).toBe(1);
    expect(cache.getVersion()).toBe(v + 1);
    off();
    cache.put('a', 2, new Fake('a2'));
    expect(calls).toBe(1);
  });

  it('stops requesting at the budget, counting requests in flight', () => {
    const { cache, requests } = setup(2);
    for (const f of [0, 10, 20, 30]) cache.want('a', f);
    expect(requests).toEqual(['a:0', 'a:1']);
    const extra = new Fake('late');
    cache.put('a', 0, new Fake('a0'));
    cache.put('a', 1, new Fake('a1'));
    cache.put('a', 9, extra); // unrequested and over budget
    expect(extra.closed).toBe(true);
    expect(cache.size).toBe(2);
  });

  it('closes everything on clear', () => {
    const { cache, requests } = setup();
    const b = new Fake('a0');
    cache.want('a', 0);
    cache.put('a', 0, b);
    cache.clear();
    expect(b.closed).toBe(true);
    expect(cache.get('a', 0)).toBeNull();
    cache.want('a', 0);
    expect(requests).toEqual(['a:0', 'a:0']);
  });
});
