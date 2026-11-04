import type { Frames } from '../model/time';
import type { Closable } from './FrameStore';

/**
 * Timeline filmstrip thumbnails, one per source keyframe group, under a byte
 * budget. Tiles ask for the frame they show (`want`), draw whatever is
 * closest so far (`get`), and redraw when `version` changes. Once the budget
 * is used up no new thumbnails are requested, and tiles keep showing the
 * nearest one their source has.
 */
export class ThumbCache<B extends Closable = ImageBitmap> {
  private readonly bySource = new Map<string, Map<number, B>>();
  private readonly requested = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private bytes = 0;
  private pending = 0;
  private v = 0;

  constructor(
    private readonly budgetBytes: number,
    private readonly thumbBytes: number,
    /** Keyframe group of a source frame, or null for an unknown source. */
    private readonly gopOf: (sourceId: string, frame: Frames) => number | null,
    /** Ask the decoder for a thumbnail; it arrives through `put`. */
    private readonly request: (sourceId: string, gop: number) => void,
  ) {}

  /** For useSyncExternalStore. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getVersion = (): number => this.v;

  get size(): number {
    let n = 0;
    for (const m of this.bySource.values()) n += m.size;
    return n;
  }

  /** Request the thumbnail for this frame's keyframe group, if it is missing and fits the budget. */
  want(sourceId: string, frame: Frames): void {
    const gop = this.gopOf(sourceId, frame);
    if (gop === null) return;
    const key = `${sourceId}:${gop}`;
    if (this.bySource.get(sourceId)?.has(gop) || this.requested.has(key)) return;
    if (this.bytes + (this.pending + 1) * this.thumbBytes > this.budgetBytes) return;
    this.requested.add(key);
    this.pending++;
    this.request(sourceId, gop);
  }

  /** The thumbnail for this frame's group, or the nearest one of the same source. */
  get(sourceId: string, frame: Frames): B | null {
    const m = this.bySource.get(sourceId);
    if (!m || m.size === 0) return null;
    const gop = this.gopOf(sourceId, frame);
    if (gop === null) return null;
    const exact = m.get(gop);
    if (exact) return exact;
    let best: number | null = null;
    for (const g of m.keys()) if (best === null || Math.abs(g - gop) < Math.abs(best - gop)) best = g;
    return m.get(best!)!;
  }

  put(sourceId: string, gop: number, bitmap: B): void {
    const key = `${sourceId}:${gop}`;
    if (this.requested.delete(key)) this.pending--;
    let m = this.bySource.get(sourceId);
    if (!m) this.bySource.set(sourceId, (m = new Map()));
    if (m.has(gop) || this.bytes + this.thumbBytes > this.budgetBytes) {
      bitmap.close();
      return;
    }
    m.set(gop, bitmap);
    this.bytes += this.thumbBytes;
    this.bump();
  }

  clear(): void {
    for (const m of this.bySource.values()) for (const b of m.values()) b.close();
    this.bySource.clear();
    this.requested.clear();
    this.bytes = 0;
    this.pending = 0;
    this.bump();
  }

  private bump() {
    this.v++;
    for (const l of this.listeners) l();
  }
}
