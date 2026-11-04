import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FrameStore, type Closable } from '../media/FrameStore';
import { shortB } from '../model/fixtures';
import type { Renderer } from '../render/Renderer';
import { PreviewController } from './PreviewController';

class Bitmap implements Closable {
  constructor(readonly name: string) {}
  close() {}
}

/** A controller over a store that has every frame, a fake clock and a manual animation-frame queue. */
function setup() {
  let now = 0;
  let queued: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    queued.push(cb);
    return queued.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});

  const store = new FrameStore<Bitmap>();
  for (const id of ['a', 'b']) for (let f = 0; f < 120; f++) store.put(id, f, new Bitmap(`${id}:${f}`), 1, 1);
  const drawn: string[] = [];
  const renderer = {
    isLost: false,
    clear: () => {},
    drawSingle: (b: Bitmap) => drawn.push(b.name),
    drawTransition: () => {},
  } as unknown as Renderer;

  const c = new PreviewController(store as unknown as FrameStore, () => now);
  const playing: boolean[] = [];
  c.setCallbacks({ onPlayhead: () => {}, onPlayingChange: (p) => playing.push(p), onPreviewChange: () => {} });
  c.attachRenderer(renderer);
  c.setDoc(shortB());
  c.setReady(true);

  /** Advance the clock and run the queued animation frames. */
  const advance = (ms: number) => {
    now += ms;
    const run = queued;
    queued = [];
    for (const cb of run) cb(now);
  };
  return { c, drawn, playing, advance };
}

const FRAME_MS = 1000 / 30;

describe('PreviewController source preview', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('plays a Library clip from its start and stops on its last frame', () => {
    const { c, drawn, advance } = setup();
    c.showSource('b', 'Clip B', 120);
    expect(c.getSourceState()).toMatchObject({ sourceId: 'b', frame: 0, playing: true });
    expect(drawn.at(-1)).toBe('b:0');

    advance(10 * FRAME_MS + 1);
    expect(c.getSourceState()?.frame).toBe(10);
    expect(drawn.at(-1)).toBe('b:10');

    advance(200 * FRAME_MS);
    expect(c.getSourceState()).toMatchObject({ frame: 119, playing: false });
  });

  it('pauses, resumes, and restarts once finished', () => {
    const { c, advance } = setup();
    c.showSource('a', 'Clip A', 120);
    advance(5 * FRAME_MS + 1);
    c.toggleSourcePlayback();
    expect(c.getSourceState()).toMatchObject({ frame: 5, playing: false });
    advance(20 * FRAME_MS);
    expect(c.getSourceState()?.frame).toBe(5);

    c.toggleSourcePlayback();
    advance(200 * FRAME_MS);
    expect(c.getSourceState()).toMatchObject({ frame: 119, playing: false });
    c.toggleSourcePlayback();
    expect(c.getSourceState()).toMatchObject({ frame: 0, playing: true });
  });

  it('seeks inside the clip, keeping play or pause', () => {
    const { c, drawn, advance } = setup();
    c.showSource('b', 'Clip B', 120);
    c.toggleSourcePlayback();
    c.seekSource(80.4);
    expect(c.getSourceState()).toMatchObject({ frame: 80, playing: false });
    expect(drawn.at(-1)).toBe('b:80');
    c.seekSource(500);
    expect(c.getSourceState()?.frame).toBe(119);

    c.seekSource(10);
    c.toggleSourcePlayback();
    c.seekSource(40);
    advance(5 * FRAME_MS + 1);
    expect(c.getSourceState()).toMatchObject({ frame: 45, playing: true });
  });

  it('notifies subscribers and returns to the timeline on close', () => {
    const { c, drawn } = setup();
    const seen: (string | null)[] = [];
    c.subscribeSource(() => seen.push(c.getSourceState()?.sourceId ?? null));
    c.showSource('b', 'Clip B', 120);
    c.endSource();
    expect(seen).toEqual(['b', null]);
    expect(c.isShowingSource).toBe(false);
    // Timeline frame 0 shows source A frame 15.
    expect(drawn.at(-1)).toBe('a:15');
  });

  it('gives way to timeline playback and playhead moves', () => {
    const { c, playing } = setup();
    c.showSource('b', 'Clip B', 120);
    c.play();
    expect(c.getSourceState()).toBeNull();
    expect(playing.at(-1)).toBe(true);

    c.showSource('b', 'Clip B', 120);
    expect(playing.at(-1)).toBe(false);
    expect(c.isPlaying).toBe(false);
    c.setPlayhead(30);
    expect(c.getSourceState()).toBeNull();
  });
});
