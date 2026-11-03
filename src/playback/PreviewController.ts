/**
 * Drives the preview canvas from one requestAnimationFrame loop.
 *
 * Everything per-frame lives here, not in React state, so hovering presets
 * never re-renders the tree. Every draw uses already-decoded ImageBitmaps, so
 * switching between the timeline and a preset preview is synchronous: the
 * canvas never shows an empty or stale frame in between (no flicker).
 */
import { getPreset, TRANSITION_DEFAULTS } from '../config/transitions.config';
import type { FrameStore } from '../media/FrameStore';
import { cubicBezier, type Bezier } from '../model/easing';
import { feelEasing, feelIntensity } from '../model/feel';
import { loopFrameAt, loopRange, onceFrameAt, rebaseElapsed, type LoopRange } from '../model/previewLoop';
import { cutFrame, resolveFrame, timelineLength, type Doc, type Transition } from '../model/timeline';
import { clamp, FPS, type Frames } from '../model/time';
import type { Renderer } from '../render/Renderer';

/** What a preview shows: a preset at a duration and feel, centred on the cut. */
export interface PreviewCandidate {
  readonly presetId: string;
  readonly duration: Frames;
  readonly feel: number;
}

export interface FrameInfo {
  readonly mode: 'timeline' | 'preview';
  readonly t: Frames;
  readonly presetId?: string;
  /** Source frames actually drawn. */
  readonly a?: Frames;
  readonly b?: Frames;
  readonly linear?: number;
  readonly eased?: number;
  /** False when a requested frame was not decoded and a neighbour was drawn. */
  readonly exact: boolean;
}

export interface ControllerCallbacks {
  onPlayhead(frame: Frames): void;
  onPlayingChange(playing: boolean): void;
  onPreviewChange(state: { active: boolean; playing: boolean }): void;
  onFrameInfo(info: FrameInfo): void;
}

const NOOP_CALLBACKS: ControllerCallbacks = {
  onPlayhead: () => {},
  onPlayingChange: () => {},
  onPreviewChange: () => {},
  onFrameInfo: () => {},
};

type Mode =
  | { readonly kind: 'idle' }
  | { readonly kind: 'playing'; readonly startFrame: Frames; readonly startTime: number }
  | {
      readonly kind: 'preview';
      readonly candidate: PreviewCandidate;
      readonly range: LoopRange;
      /** Single pass that stops on the last frame (reduced motion). */
      readonly once: boolean;
      readonly playing: boolean;
      /** Showing the representative still at the cut; nothing has played yet. */
      readonly still: boolean;
      readonly startTime: number;
      readonly elapsedAtStart: Frames;
      readonly frame: Frames;
    };

export interface PreviewOptions {
  /** Start playing immediately. False under reduced motion: show a still at the cut. */
  readonly autoplay: boolean;
  /** Play one pass instead of looping. */
  readonly once: boolean;
}

export class PreviewController {
  private renderer: Renderer | null = null;
  private doc: Doc | null = null;
  private playhead: Frames = 0;
  private ready = false;
  private mode: Mode = { kind: 'idle' };
  private raf = 0;
  private lastKey = '';
  private easings = new Map<string, (x: number) => number>();
  private cb: ControllerCallbacks = NOOP_CALLBACKS;

  constructor(
    private readonly store: FrameStore,
    private readonly now: () => number = () => performance.now(),
  ) {}

  setCallbacks(cb: ControllerCallbacks | null) {
    this.cb = cb ?? NOOP_CALLBACKS;
  }

  attachRenderer(r: Renderer | null) {
    this.renderer = r;
    this.redrawNow();
  }

  setReady(ready: boolean) {
    this.ready = ready;
    if (!ready) this.stopAll();
    this.redrawNow();
  }

  setDoc(doc: Doc) {
    if (doc === this.doc) return;
    const lengthChanged = !this.doc || timelineLength(this.doc) !== timelineLength(doc);
    this.doc = doc;
    if (lengthChanged) this.stopAll();
    this.draw();
  }

  setPlayhead(frame: Frames) {
    if (frame === this.playhead) return;
    this.playhead = frame;
    if (this.mode.kind === 'playing') this.mode = { kind: 'playing', startFrame: frame, startTime: this.now() };
    this.draw();
  }

  get isPlaying() {
    return this.mode.kind === 'playing';
  }

  get isPreviewing() {
    return this.mode.kind === 'preview';
  }

  get isPreviewPlaying() {
    return this.mode.kind === 'preview' && this.mode.playing;
  }

  // --- timeline playback -----------------------------------------------------

  play() {
    if (!this.doc || !this.ready) return;
    this.leavePreview(false);
    const last = timelineLength(this.doc) - 1;
    const start = this.playhead >= last ? 0 : this.playhead;
    this.playhead = start;
    this.mode = { kind: 'playing', startFrame: start, startTime: this.now() };
    this.cb.onPlayhead(start);
    this.cb.onPlayingChange(true);
    this.draw();
    this.schedule();
  }

  pause() {
    if (this.mode.kind !== 'playing') return;
    this.mode = { kind: 'idle' };
    this.cb.onPlayingChange(false);
    this.draw();
  }

  togglePlay() {
    if (this.mode.kind === 'playing') this.pause();
    else this.play();
  }

  // --- preset preview --------------------------------------------------------

  /**
   * Show a preset on the footage around the cut. Called again with another
   * preset while previewing, it switches instantly and keeps the same
   * timeline frame, so presets compare at the same moment.
   */
  preview(candidate: PreviewCandidate, opts: PreviewOptions) {
    const doc = this.doc;
    if (!doc || !this.ready || candidate.duration < 2) return;
    if (this.mode.kind === 'playing') {
      this.mode = { kind: 'idle' };
      this.cb.onPlayingChange(false);
    }
    const { leadIn, tail, hold } = TRANSITION_DEFAULTS.preview;
    const cut = cutFrame(doc);
    const range = loopRange(cut, candidate.duration, leadIn, tail, hold, timelineLength(doc));
    const still = clamp(cut, range.start, range.end - 1);
    const now = this.now();
    const prev = this.mode.kind === 'preview' ? this.mode : null;

    let next: Mode;
    if (prev && prev.playing) {
      const elapsed = rebaseElapsed(prev.frame, range);
      next = { kind: 'preview', candidate, range, once: prev.once, playing: true, still: false, startTime: now, elapsedAtStart: elapsed, frame: range.start + elapsed };
    } else if (prev && opts.autoplay) {
      // Paused by the user: stay paused on the same moment.
      const elapsed = rebaseElapsed(prev.frame, range);
      next = { kind: 'preview', candidate, range, once: opts.once, playing: false, still: false, startTime: now, elapsedAtStart: elapsed, frame: range.start + elapsed };
    } else if (opts.autoplay) {
      next = { kind: 'preview', candidate, range, once: opts.once, playing: true, still: false, startTime: now, elapsedAtStart: 0, frame: range.start };
    } else {
      // Reduced motion: no autoplay. Show the moment of the cut until the user presses play.
      next = { kind: 'preview', candidate, range, once: true, playing: false, still: true, startTime: now, elapsedAtStart: 0, frame: still };
    }
    this.mode = next;
    this.cb.onPreviewChange({ active: true, playing: next.playing });
    this.draw();
    if (next.playing) this.schedule();
  }

  /** Space / Play preview. A single-pass preview restarts from the beginning once finished. */
  togglePreviewPlayback() {
    const m = this.mode;
    if (m.kind !== 'preview') return;
    const now = this.now();
    if (m.playing) {
      this.mode = { ...m, playing: false };
    } else {
      const finished = m.once && m.frame >= m.range.end - 1;
      const elapsed = m.still || finished ? 0 : m.frame - m.range.start;
      this.mode = { ...m, playing: true, still: false, startTime: now, elapsedAtStart: elapsed, frame: m.range.start + elapsed };
      this.schedule();
    }
    this.cb.onPreviewChange({ active: true, playing: !m.playing });
    this.draw();
  }

  /** Return to the timeline state. Draws synchronously so the next composited frame is correct. */
  endPreview() {
    this.leavePreview(true);
  }

  /** Redraw unconditionally, e.g. after a canvas resize (which clears it). */
  redrawNow() {
    this.lastKey = '';
    this.draw();
  }

  dispose() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  // --- internals -------------------------------------------------------------

  private leavePreview(draw: boolean) {
    if (this.mode.kind !== 'preview') return;
    this.mode = { kind: 'idle' };
    this.cb.onPreviewChange({ active: false, playing: false });
    if (draw) this.draw();
  }

  private stopAll() {
    if (this.mode.kind === 'playing') this.cb.onPlayingChange(false);
    if (this.mode.kind === 'preview') this.cb.onPreviewChange({ active: false, playing: false });
    this.mode = { kind: 'idle' };
  }

  private schedule() {
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
  }

  private tick = () => {
    this.raf = 0;
    const m = this.mode;
    const elapsedFrames = (start: number) => Math.floor(((this.now() - start) * FPS) / 1000);
    let more = false;

    if (m.kind === 'playing' && this.doc) {
      const last = timelineLength(this.doc) - 1;
      const f = Math.min(last, m.startFrame + elapsedFrames(m.startTime));
      if (f !== this.playhead) {
        this.playhead = f;
        this.cb.onPlayhead(f);
      }
      if (f >= last) {
        this.mode = { kind: 'idle' };
        this.cb.onPlayingChange(false);
      } else {
        more = true;
      }
    } else if (m.kind === 'preview' && m.playing) {
      const elapsed = m.elapsedAtStart + elapsedFrames(m.startTime);
      if (m.once) {
        const r = onceFrameAt(m.range, elapsed);
        this.mode = { ...m, frame: r.frame, playing: !r.done };
        if (r.done) this.cb.onPreviewChange({ active: true, playing: false });
        else more = true;
      } else {
        this.mode = { ...m, frame: loopFrameAt(m.range, elapsed) };
        more = true;
      }
    }

    this.draw();
    if (more) this.schedule();
  };

  private ease(b: Bezier) {
    const k = b.join(',');
    let fn = this.easings.get(k);
    if (!fn) {
      fn = cubicBezier(b);
      this.easings.set(k, fn);
      if (this.easings.size > 512) this.easings.clear();
    }
    return fn;
  }

  private draw() {
    const { renderer, doc } = this;
    if (!renderer || !doc || !this.ready || renderer.isLost) return;

    const m = this.mode;
    const isPreview = m.kind === 'preview';
    const t = isPreview ? m.frame : this.playhead;
    const transition: Transition | null = isPreview ? { id: 'preview', ...m.candidate } : doc.transition;
    const r = resolveFrame(doc, t, transition);
    const mode = isPreview ? 'preview' : 'timeline';

    if (r.kind === 'single') {
      const look = this.store.get(r.source.clipId, r.source.frame);
      if (!look) return;
      const key = `s|${r.source.clipId}|${look.frame}`;
      if (key !== this.lastKey) {
        renderer.drawSingle(look.bitmap);
        this.lastKey = key;
      }
      const side = r.source.clipId === doc.a.id ? 'a' : 'b';
      this.cb.onFrameInfo({ mode, t: r.t, [side]: look.frame, exact: look.exact, presetId: transition?.presetId });
      return;
    }

    const preset = getPreset(r.presetId);
    const from = this.store.get(r.from.clipId, r.from.frame);
    const to = this.store.get(r.to.clipId, r.to.frame);
    if (!from || !to) return;
    const eased = this.ease(feelEasing(r.feel, preset.feel))(r.linear);
    const intensity = feelIntensity(r.feel, preset.feel);
    const key = `t|${preset.id}|${from.frame}|${to.frame}|${eased}|${intensity}|${preset.params.join(',')}`;
    if (key !== this.lastKey) {
      renderer.drawTransition({
        programId: preset.id,
        from: from.bitmap,
        to: to.bitmap,
        progress: eased,
        linear: r.linear,
        intensity,
        params: preset.params,
      });
      this.lastKey = key;
    }
    this.cb.onFrameInfo({
      mode,
      t: r.t,
      presetId: preset.id,
      a: from.frame,
      b: to.frame,
      linear: r.linear,
      eased,
      exact: from.exact && to.exact,
    });
  }
}
