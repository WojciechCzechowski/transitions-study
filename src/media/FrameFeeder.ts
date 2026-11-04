import type { FrameRef } from '../model/timeline';
import type { Frames } from '../model/time';
import type { Closable, FrameStore } from './FrameStore';

/** One source's decoder, as the feeder sees it (ClipDecoder in the app, fakes in tests). */
export interface GopSource<B> {
  readonly sourceId: string;
  /** Size of the bitmaps it produces. */
  readonly width: number;
  readonly height: number;
  gopOf(frame: Frames): number;
  /**
   * Decode one keyframe group, calling `emit` for each frame in order. The
   * receiver owns every emitted bitmap (it stores or closes it).
   */
  decodeGop(gop: number, emit: (frame: Frames, bitmap: B) => void): Promise<void>;
}

interface Poster<B> {
  readonly sourceId: string;
  readonly frame: Frames;
  readonly draw: (bitmap: B) => void;
}

/**
 * Turns "frames wanted now" into decodes. One keyframe group in flight per
 * source, sources in parallel, most urgent missing frame first. Every frame
 * of a decoded group is stored, since playback usually reaches the rest of
 * the group next; the store evicts frames nobody wants first, so they never
 * push out wanted ones. Library posters are decoded after the preview's own
 * demand.
 */
export class FrameFeeder<B extends Closable = ImageBitmap> {
  private demand: readonly FrameRef[] = [];
  private readonly busy = new Set<string>();
  private readonly failed = new Set<string>();
  private posters: Poster<B>[] = [];
  private disposed = false;

  constructor(
    private readonly store: FrameStore<B>,
    private readonly sources: ReadonlyMap<string, GopSource<B>>,
    private readonly onFrames: () => void,
    private readonly onError: (sourceId: string, error: unknown) => void,
  ) {}

  /** Frames needed now, most urgent first. Replaces the previous demand. */
  setDemand(refs: readonly FrameRef[]): void {
    if (this.disposed) return;
    this.demand = refs;
    this.store.setWanted(refs);
    this.pump();
  }

  /** Decode one frame for a Library poster; `draw` gets it once, then it is closed. Returns a cancel function. */
  requestPoster(sourceId: string, frame: Frames, draw: (bitmap: B) => void): () => void {
    const p: Poster<B> = { sourceId, frame, draw };
    this.posters.push(p);
    this.pump();
    return () => {
      this.posters = this.posters.filter((x) => x !== p);
    };
  }

  /** Sources with a decode in flight (for tests and diagnostics). */
  get inFlight(): ReadonlySet<string> {
    return this.busy;
  }

  dispose(): void {
    this.disposed = true;
    this.demand = [];
    this.posters = [];
  }

  /** The most urgent frame of this source that is missing: demand first, then posters. */
  private nextTarget(src: GopSource<B>): { frame: Frames; poster: boolean } | null {
    for (const r of this.demand) {
      if (r.sourceId === src.sourceId && !this.store.has(r.sourceId, r.frame)) return { frame: r.frame, poster: false };
    }
    const p = this.posters.find((x) => x.sourceId === src.sourceId);
    return p ? { frame: p.frame, poster: true } : null;
  }

  private pump() {
    if (this.disposed) return;
    for (const src of this.sources.values()) {
      if (this.busy.has(src.sourceId) || this.failed.has(src.sourceId)) continue;
      const target = this.nextTarget(src);
      if (target === null) continue;
      this.busy.add(src.sourceId);
      const fail = (e: unknown) => {
        this.busy.delete(src.sourceId);
        this.failed.add(src.sourceId);
        if (!this.disposed) this.onError(src.sourceId, e);
      };
      src
        .decodeGop(src.gopOf(target.frame), (frame, bitmap) => this.receive(src, frame, bitmap))
        .then(() => {
          // A frame the decoder never produced would otherwise be requested forever.
          const missing = target.poster
            ? this.posters.some((p) => p.sourceId === src.sourceId && p.frame === target.frame)
            : this.store.isWanted(src.sourceId, target.frame) && !this.store.has(src.sourceId, target.frame);
          if (missing) {
            fail(new Error(`The decoder produced no frame ${target.frame} for clip "${src.sourceId}".`));
            return;
          }
          this.busy.delete(src.sourceId);
          this.pump();
        }, fail);
    }
  }

  private receive(src: GopSource<B>, frame: Frames, bitmap: B) {
    if (this.disposed) {
      bitmap.close();
      return;
    }
    const poster = this.posters.find((p) => p.sourceId === src.sourceId && p.frame === frame);
    if (poster) {
      this.posters = this.posters.filter((p) => p !== poster);
      poster.draw(bitmap);
    }
    const wanted = this.store.isWanted(src.sourceId, frame);
    if (!wanted && poster) {
      bitmap.close(); // a poster frame nobody else needs
      return;
    }
    this.store.put(src.sourceId, frame, bitmap, src.width, src.height);
    if (wanted) this.onFrames();
  }
}
