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
}

export interface Lookup<B> {
  readonly bitmap: B;
  readonly frame: Frames;
  /** False when the requested frame was not decoded and a neighbour is shown instead. */
  readonly exact: boolean;
}

const key = (clipId: string, frame: Frames) => `${clipId}:${frame}`;

/** Pre-decoded frames keyed by clip and source frame, with byte accounting. */
export class FrameStore<B extends Closable = ImageBitmap> {
  private readonly entries = new Map<string, Entry<B>>();
  private readonly frames = new Map<string, Set<Frames>>();
  private totalBytes = 0;

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

  put(clipId: string, frame: Frames, bitmap: B, width: number, height: number): void {
    const k = key(clipId, frame);
    this.evictKey(k, clipId, frame);
    const bytes = width * height * 4;
    this.entries.set(k, { bitmap, width, height, bytes });
    let set = this.frames.get(clipId);
    if (!set) this.frames.set(clipId, (set = new Set()));
    set.add(frame);
    this.totalBytes += bytes;
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

  private evictKey(k: string, clipId: string, frame: Frames) {
    const e = this.entries.get(k);
    if (!e) return;
    e.bitmap.close();
    this.entries.delete(k);
    this.frames.get(clipId)?.delete(frame);
    this.totalBytes -= e.bytes;
  }
}
