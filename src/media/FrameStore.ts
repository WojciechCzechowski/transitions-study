import type { Frames } from '../model/time';

/** Anything closable, so tests can use fakes instead of ImageBitmap. */
export interface Closable {
  close(): void;
}

interface Entry<B> {
  readonly bitmap: B;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  /** Value of the store's clock when this frame was last wanted (or stored). */
  lastWanted: number;
}

export interface Lookup<B> {
  readonly bitmap: B;
  readonly frame: Frames;
  /** False when the requested frame was not decoded and a neighbour is shown instead. */
  readonly exact: boolean;
}

export interface WantedFrame {
  readonly sourceId: string;
  readonly frame: Frames;
}

const key = (clipId: string, frame: Frames) => `${clipId}:${frame}`;

/**
 * Decoded frames keyed by clip and source frame, under a byte budget.
 * Frames the preview currently wants are never evicted; the others go
 * least-recently-wanted first, and every evicted bitmap is closed.
 */
export class FrameStore<B extends Closable = ImageBitmap> {
  private readonly entries = new Map<string, Entry<B>>();
  private readonly frames = new Map<string, Set<Frames>>();
  private wanted = new Set<string>();
  private clock = 0;
  private totalBytes = 0;

  constructor(readonly budgetBytes = Number.POSITIVE_INFINITY) {}

  get bytes(): number {
    return this.totalBytes;
  }

  get size(): number {
    return this.entries.size;
  }

  has(clipId: string, frame: Frames, width?: number, height?: number): boolean {
    const e = this.entries.get(key(clipId, frame));
    return !!e && (width === undefined || (e.width === width && e.height === height));
  }

  /** Whether the latest `setWanted` asked for this frame. */
  isWanted(clipId: string, frame: Frames): boolean {
    return this.wanted.has(key(clipId, frame));
  }

  /** Replace the set of frames the preview needs now. They are protected from eviction. */
  setWanted(frames: readonly WantedFrame[]): void {
    this.clock++;
    this.wanted = new Set(frames.map((f) => key(f.sourceId, f.frame)));
    for (const k of this.wanted) {
      const e = this.entries.get(k);
      if (e) e.lastWanted = this.clock;
    }
    this.trim();
  }

  put(clipId: string, frame: Frames, bitmap: B, width: number, height: number): void {
    const k = key(clipId, frame);
    this.evictKey(k, clipId, frame);
    const bytes = width * height * 4;
    this.entries.set(k, { bitmap, width, height, bytes, lastWanted: this.clock });
    let set = this.frames.get(clipId);
    if (!set) this.frames.set(clipId, (set = new Set()));
    set.add(frame);
    this.totalBytes += bytes;
    this.trim();
  }

  /** Exact frame, or the nearest decoded frame of the same clip. */
  get(clipId: string, frame: Frames): Lookup<B> | null {
    const exact = this.entries.get(key(clipId, frame));
    if (exact) return { bitmap: exact.bitmap, frame, exact: true };
    const set = this.frames.get(clipId);
    if (!set || set.size === 0) return null;
    let best: Frames | null = null;
    for (const f of set) {
      if (best === null || Math.abs(f - frame) < Math.abs(best - frame)) best = f;
    }
    const e = this.entries.get(key(clipId, best!))!;
    return { bitmap: e.bitmap, frame: best!, exact: false };
  }

  /** Keep only entries for which `keep` returns true; close the rest. */
  retain(keep: (clipId: string, frame: Frames, width: number, height: number) => boolean): void {
    for (const [clipId, set] of this.frames) {
      for (const frame of [...set]) {
        const e = this.entries.get(key(clipId, frame))!;
        if (!keep(clipId, frame, e.width, e.height)) this.evictKey(key(clipId, frame), clipId, frame);
      }
    }
  }

  clear(): void {
    this.retain(() => false);
  }

  /** Evict unwanted frames, least recently wanted first, until the store fits its budget. */
  private trim() {
    if (this.totalBytes <= this.budgetBytes) return;
    const victims = [...this.entries.entries()]
      .filter(([k]) => !this.wanted.has(k))
      .sort((x, y) => x[1].lastWanted - y[1].lastWanted);
    for (const [k] of victims) {
      if (this.totalBytes <= this.budgetBytes) break;
      const sep = k.lastIndexOf(':');
      this.evictKey(k, k.slice(0, sep), Number(k.slice(sep + 1)));
    }
  }

  private evictKey(k: string, clipId: string, frame: Frames) {
    const e = this.entries.get(k);
    if (!e) return;
    e.bitmap.close();
    this.entries.delete(k);
    this.frames.get(clipId)?.delete(frame);
    this.totalBytes -= e.bytes;
  }
}
