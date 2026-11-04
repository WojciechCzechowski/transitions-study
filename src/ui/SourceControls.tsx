import { Pause, Play, X } from 'lucide-react';
import { useRef, useSyncExternalStore, type PointerEvent } from 'react';
import { hasMarks, markedRange, type Marks } from '../model/marks';
import { clamp, formatSeconds, formatTimecode, type Frames } from '../model/time';
import type { PreviewController } from '../playback/PreviewController';

interface Props {
  controller: PreviewController;
  /** Marks on the shown clip. */
  marks: Marks | undefined;
  onMarkIn: (frame: Frames) => void;
  onMarkOut: (frame: Frames) => void;
  onClearMarks: () => void;
}

const ICON = 14;

/**
 * Over the preview while it plays a Library clip instead of the timeline:
 * what is shown, a scrubbable bar with the in/out marks, and the mark
 * buttons. The marks choose the part of the clip that Insert (and a drag
 * from the Library) adds to the timeline.
 */
export function SourceControls({ controller, marks, onMarkIn, onMarkOut, onClearMarks }: Props) {
  const source = useSyncExternalStore(controller.subscribeSource, controller.getSourceState);
  const barRef = useRef<HTMLDivElement>(null);
  const scrubbing = useRef<number | null>(null);
  if (!source) return null;

  const last = Math.max(1, source.frames - 1);
  const pct = (f: Frames) => `${(clamp(f, 0, last) / last) * 100}%`;
  const marked = hasMarks(marks);
  const rangeIn = marks?.in ?? 0;
  const rangeOut = marks?.out ?? last;
  // What Insert or a drag adds: the marked part, or the whole clip.
  const added = markedRange(source.frames, marks);
  const addedLabel = formatSeconds(added.sourceOut - added.sourceIn);

  const seekAt = (clientX: number) => {
    const box = barRef.current?.getBoundingClientRect();
    if (!box || box.width <= 0) return;
    controller.seekSource(((clientX - box.left) / box.width) * last);
  };
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    scrubbing.current = e.pointerId;
    seekAt(e.clientX);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (scrubbing.current === e.pointerId) seekAt(e.clientX);
  };
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    if (scrubbing.current === e.pointerId) scrubbing.current = null;
  };

  return (
    <div className="source-overlay" role="group" aria-label={`Library clip ${source.label}`}>
      <div className="source-top">
        <span className="source-chip">
          <span className="source-chip-kind">Library</span>
          <span className="source-chip-name">{source.label}</span>
        </span>
        <button
          type="button"
          className="source-btn"
          onClick={() => controller.endSource()}
          aria-label="Back to the timeline"
          data-tip="Back to timeline"
          data-keys="Esc"
          aria-keyshortcuts="Escape"
        >
          <X size={ICON} aria-hidden="true" />
        </button>
      </div>
      <div className="source-bottom">
        <button
          type="button"
          className="source-btn"
          onClick={() => controller.toggleSourcePlayback()}
          aria-label={source.playing ? 'Pause' : 'Play'}
          aria-keyshortcuts="Space"
        >
          {source.playing ? <Pause size={ICON} aria-hidden="true" fill="currentColor" /> : <Play size={ICON} aria-hidden="true" fill="currentColor" />}
        </button>
        <div
          ref={barRef}
          className="source-scrub"
          role="slider"
          aria-label="Position in the clip"
          aria-valuemin={0}
          aria-valuemax={last}
          aria-valuenow={source.frame}
          aria-valuetext={formatTimecode(source.frame)}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          tabIndex={0}
          onKeyDown={(e) => {
            const step = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
            if (!step) return;
            e.preventDefault();
            controller.seekSource(source.frame + step * (e.shiftKey ? 10 : 1));
          }}
        >
          <div className="source-track">
            {marked && (
              <div className="source-range" style={{ left: pct(rangeIn), width: `calc(${pct(rangeOut)} - ${pct(rangeIn)})` }} />
            )}
          </div>
          {marks?.in !== undefined && <div className="source-mark source-mark-in" style={{ left: pct(marks.in) }} />}
          {marks?.out !== undefined && <div className="source-mark source-mark-out" style={{ left: pct(marks.out) }} />}
          <div className="source-knob" style={{ left: pct(source.frame) }} />
        </div>
        <span className="source-time">
          {formatTimecode(source.frame)} <span className="source-time-total">/ {formatTimecode(source.frames)}</span>
        </span>
        <span className="source-marks" role="group" aria-label="In and out marks">
          <button
            type="button"
            className="source-btn"
            onClick={() => onMarkIn(source.frame)}
            aria-label="Mark in at this frame"
            data-tip="Mark in"
            data-keys="I"
            aria-keyshortcuts="I"
          >
            <MarkGlyph side="in" />
          </button>
          <button
            type="button"
            className="source-btn"
            onClick={() => onMarkOut(source.frame)}
            aria-label="Mark out at this frame"
            data-tip="Mark out"
            data-keys="O"
            aria-keyshortcuts="O"
          >
            <MarkGlyph side="out" />
          </button>
          {/* Always present at a fixed width, so marking never shifts the bar. */}
          {marked ? (
            <button
              type="button"
              className="source-pill"
              onClick={onClearMarks}
              aria-label={`Marked ${addedLabel}. Clear the marks`}
              data-tip="Clear marks"
            >
              {addedLabel}
              <X size={11} aria-hidden="true" />
            </button>
          ) : (
            <span
              className="source-pill source-pill-default"
              aria-label={`Insert adds ${addedLabel}`}
              data-tip="Insert adds this much. Mark in and out to choose"
            >
              {addedLabel}
              <X size={11} aria-hidden="true" />
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

/** A square bracket with a tick: the mark in / mark out glyphs. */
function MarkGlyph({ side }: { side: 'in' | 'out' }) {
  const d = side === 'in' ? 'M9.5 3.5h-4v9h4' : 'M6.5 3.5h4v9h-4';
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
