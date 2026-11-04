import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import type { FrameStore } from '../media/FrameStore';
import type { Source } from '../model/timeline';
import { formatSeconds } from '../model/time';

interface Props {
  sources: readonly Source[];
  store: FrameStore;
  ready: boolean;
  /** Colour slot per source, matching the timeline. */
  sourceTone: (sourceId: string) => number;
  /** Pointer drag lifecycle; the editor hit-tests the timeline and draws the ghost. */
  onDragStart: (sourceId: string, clientX: number, clientY: number) => void;
  onDragMove: (clientX: number, clientY: number) => void;
  onDragEnd: (commit: boolean) => void;
  /** Keyboard: add at the clip boundary nearest the playhead. */
  onAdd: (sourceId: string) => void;
}

const DRAG_THRESHOLD_PX = 4;

/** The prepared clips. Drag one into the timeline (as often as you like), or press Enter. */
export function LibraryPanel({ sources, store, ready, sourceTone, ...on }: Props) {
  return (
    <section className="lpanel" role="tabpanel" aria-labelledby="library-heading">
      <header className="tpanel-head">
        <h2 id="library-heading" className="tpanel-title">
          Library
        </h2>
        <span className="muted lpanel-count">
          {sources.length} clip{sources.length === 1 ? '' : 's'}
        </span>
      </header>
      <div className="tpanel-body">
        <ul className="library-list" aria-label="Library clips" aria-describedby="library-hint">
          {sources.map((s) => (
            <li key={s.id}>
              <LibraryCard source={s} store={store} ready={ready} tone={sourceTone(s.id)} {...on} />
            </li>
          ))}
        </ul>
        <p className="gallery-keys muted" id="library-hint">
          Drag a clip into the timeline. Enter adds it at the playhead.
        </p>
      </div>
    </section>
  );
}

function LibraryCard({
  source,
  store,
  ready,
  tone,
  onDragStart,
  onDragMove,
  onDragEnd,
  onAdd,
}: Omit<Props, 'sources' | 'sourceTone'> & { source: Source; tone: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const press = useRef<{ pointerId: number; x: number; y: number; dragging: boolean } | null>(null);

  // Poster: the decoded middle frame.
  useEffect(() => {
    if (!ready) return;
    const canvas = canvasRef.current;
    const look = store.get(source.id, Math.floor(source.frames / 2));
    const ctx = canvas?.getContext('2d');
    if (!canvas || !look || !ctx) return;
    canvas.width = look.bitmap.width;
    canvas.height = look.bitmap.height;
    ctx.drawImage(look.bitmap, 0, 0);
  }, [ready, store, source]);

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || !ready) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, dragging: false };
  };
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p || p.pointerId !== e.pointerId) return;
    if (!p.dragging && Math.hypot(e.clientX - p.x, e.clientY - p.y) >= DRAG_THRESHOLD_PX) {
      p.dragging = true;
      onDragStart(source.id, e.clientX, e.clientY);
    }
    if (p.dragging) onDragMove(e.clientX, e.clientY);
  };
  const onPointerUp = (e: PointerEvent<HTMLButtonElement>, cancelled = false) => {
    const p = press.current;
    if (!p || p.pointerId !== e.pointerId) return;
    press.current = null;
    if (p.dragging) onDragEnd(!cancelled);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (ready) onAdd(source.id);
    }
  };

  return (
    <button
      type="button"
      className={`library-card tone-${tone % 4}`}
      aria-label={`${source.label}, ${formatSeconds(source.frames)}. Drag into the timeline, or press Enter to add it at the playhead.`}
      aria-disabled={!ready || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => onPointerUp(e)}
      onPointerCancel={(e) => onPointerUp(e, true)}
      onKeyDown={onKeyDown}
    >
      <span className="library-thumb">
        <canvas ref={canvasRef} aria-hidden="true" />
        <span className="library-duration">{formatSeconds(source.frames)}</span>
      </span>
      <span className="preset-name">{source.label}</span>
      <span className="preset-hint">{source.frames} frames</span>
    </button>
  );
}
