import { Pause, Play } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent } from 'react';
import type { FrameFeeder } from '../media/FrameFeeder';
import { HelpPopover, type HelpKey } from './HelpPopover';
import type { ThumbCache } from '../media/ThumbCache';
import { hasMarks, type Marks } from '../model/marks';
import { skimFrame } from '../model/skim';
import type { Source } from '../model/timeline';
import { formatSeconds, type Frames } from '../model/time';

/** The Library clip shown in the preview, if any. */
export interface ShownSource {
  readonly sourceId: string;
  readonly playing: boolean;
}

interface Props {
  sources: readonly Source[];
  /** Decodes the poster frames; null while the clips load. */
  feeder: FrameFeeder | null;
  /** Keyframe thumbnails, shared with the timeline filmstrip; used for skimming. */
  thumbs: ThumbCache | null;
  ready: boolean;
  /** Colour slot per source, matching the timeline. */
  sourceTone: (sourceId: string) => number;
  shown: ShownSource | null;
  /** In/out marks per clip, set in the preview; a drag or Insert adds the marked part. */
  marks: Readonly<Record<string, Marks>>;
  /** Pointer drag lifecycle; the editor hit-tests the timeline and draws the ghost. */
  onDragStart: (sourceId: string, clientX: number, clientY: number) => void;
  onDragMove: (clientX: number, clientY: number) => void;
  onDragEnd: (commit: boolean) => void;
  /** Play button: play this clip in the preview, or pause/resume it if it is already shown. */
  onTogglePlay: (sourceId: string) => void;
  /** Double-click: play this clip in the preview from its start. */
  onPlayFromStart: (sourceId: string) => void;
}

const DRAG_THRESHOLD_PX = 4;

const LIBRARY_KEYS: readonly HelpKey[] = [
  { action: 'Pause / resume the clip in the preview', keys: ['Space'] },
  { action: 'Mark in / out at this frame', keys: ['I', 'O'] },
  { action: 'Insert at the playhead', keys: ['W'] },
  { action: 'Back to the timeline', keys: ['Esc'] },
];
const ICON = 12;

const noSubscribe = () => () => {};
const zero = () => 0;

/**
 * The prepared clips. Drag one into the timeline (as often as you like).
 * Hover a thumbnail to skim it; the play button or a double-click plays it
 * in the preview.
 */
export function LibraryPanel({ sources, sourceTone, shown, marks, ...rest }: Props) {
  return (
    <section className="lpanel" role="tabpanel" aria-labelledby="library-heading">
      <header className="tpanel-head">
        <div className="tpanel-heading">
          <h2 id="library-heading" className="tpanel-title">
            Library
          </h2>
          <span className="muted lpanel-count">
            {sources.length} clip{sources.length === 1 ? '' : 's'}
          </span>
        </div>
        <HelpPopover keys={{ title: 'Keyboard, while a clip plays', items: LIBRARY_KEYS }}>
          <p className="help-pop-note">
            Drag a clip into the timeline to add it; the same clip can go in as often as you like. Hover a thumbnail to
            skim through it.
          </p>
          <p className="help-pop-note">
            Click ▶ on a thumbnail, or double-click the clip, to play it in the preview. Esc, ✕ or a click in the
            timeline goes back to the timeline.
          </p>
          <p className="help-pop-note">
            In the preview, mark in and out to choose the part you want. Insert, next to Split, adds the last played
            clip at the playhead: inside a clip it splits it and puts the new clip in the gap. Dragging a clip adds its
            marked part too.
          </p>
        </HelpPopover>
      </header>
      <div className="tpanel-body">
        <ul className="library-list" aria-label="Library clips">
          {sources.map((s) => (
            <li key={s.id}>
              <LibraryCard
                source={s}
                tone={sourceTone(s.id)}
                shown={shown?.sourceId === s.id}
                playing={shown?.sourceId === s.id && shown.playing}
                marks={marks[s.id]}
                {...rest}
              />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function LibraryCard({
  source,
  feeder,
  thumbs,
  ready,
  tone,
  shown,
  playing,
  onDragStart,
  onDragMove,
  onDragEnd,
  onTogglePlay,
  onPlayFromStart,
  marks,
}: Omit<Props, 'sources' | 'sourceTone' | 'shown' | 'marks'> & {
  source: Source;
  tone: number;
  shown: boolean;
  playing: boolean;
  marks: Marks | undefined;
}) {
  const posterRef = useRef<HTMLCanvasElement>(null);
  const skimRef = useRef<HTMLCanvasElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const skimDrawn = useRef<ImageBitmap | null>(null);
  const press = useRef<{ pointerId: number; x: number; y: number; dragging: boolean } | null>(null);
  /** Skim position as a fraction of the thumbnail width, while the pointer hovers it. */
  const [skim, setSkim] = useState<number | null>(null);
  const skimming = skim !== null && thumbs !== null;
  const skimAt: Frames | null = skim === null ? null : skimFrame(skim, source.frames);
  // Redraw as skim thumbnails arrive, but only while skimming.
  const skimThumbs = skim !== null ? thumbs : null;
  const thumbsVersion = useSyncExternalStore(skimThumbs?.subscribe ?? noSubscribe, skimThumbs?.getVersion ?? zero);

  // Poster: the middle frame, decoded once and copied onto the card's own canvas.
  useEffect(() => {
    if (!feeder) return;
    return feeder.requestPoster(source.id, Math.floor(source.frames / 2), (bitmap) => {
      const canvas = posterRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      ctx.drawImage(bitmap, 0, 0);
    });
  }, [feeder, source]);

  // Skim: the nearest keyframe thumbnail decoded so far, sharpening as the exact one arrives.
  useEffect(() => {
    const canvas = skimRef.current;
    if (!canvas) return;
    const bitmap = thumbs && skimAt !== null ? thumbs.get(source.id, skimAt) : null;
    if (thumbs && skimAt !== null) thumbs.want(source.id, skimAt);
    if (bitmap === skimDrawn.current) return;
    skimDrawn.current = bitmap;
    if (!bitmap) {
      canvas.classList.remove('ready');
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
    }
    ctx.drawImage(bitmap, 0, 0);
    canvas.classList.add('ready');
  }, [thumbs, source.id, skimAt, thumbsVersion]);

  /** Skim under a hovering mouse or pen; touch has no hover, and a press means a drag. */
  const updateSkim = (e: PointerEvent<HTMLButtonElement>) => {
    const box = thumbRef.current?.getBoundingClientRect();
    if (!box || !ready || e.pointerType === 'touch' || press.current?.dragging) {
      setSkim(null);
      return;
    }
    const inside = e.clientX >= box.left && e.clientX <= box.right && e.clientY >= box.top && e.clientY <= box.bottom;
    setSkim(inside && box.width > 0 ? (e.clientX - box.left) / box.width : null);
  };

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || !ready) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, dragging: false };
  };
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p || p.pointerId !== e.pointerId) {
      updateSkim(e);
      return;
    }
    if (!p.dragging && Math.hypot(e.clientX - p.x, e.clientY - p.y) >= DRAG_THRESHOLD_PX) {
      p.dragging = true;
      setSkim(null);
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
  const playLabel = playing ? `Pause ${source.label}` : `Play ${source.label} in the preview`;

  return (
    <div className={`library-card tone-${tone % 4}${shown ? ' shown' : ''}${skimming ? ' skimming' : ''}`}>
      <button
        type="button"
        className="library-card-main"
        aria-label={`${source.label}, ${formatSeconds(source.frames)}. Drag into the timeline. Double-click to play it in the preview.`}
        aria-disabled={!ready || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setSkim(null)}
        onPointerUp={(e) => onPointerUp(e)}
        onPointerCancel={(e) => onPointerUp(e, true)}
        onDoubleClick={() => ready && onPlayFromStart(source.id)}
      >
        <span className="library-thumb" ref={thumbRef}>
          <canvas ref={posterRef} aria-hidden="true" />
          <canvas ref={skimRef} className="library-skim" aria-hidden="true" />
          {hasMarks(marks) && <MarkedSpan marks={marks!} frames={source.frames} />}
          {skimming && <span className="library-skimhead" style={{ left: `${skim * 100}%` }} aria-hidden="true" />}
          <span className="library-duration">{formatSeconds(skimming && skimAt !== null ? skimAt : source.frames)}</span>
        </span>
        <span className="preset-name">{source.label}</span>
        <span className="preset-hint">{source.frames} frames</span>
      </button>
      <button
        type="button"
        className={`library-play${playing ? ' playing' : ''}`}
        aria-label={playLabel}
        data-tip={playing ? 'Pause' : 'Play in preview'}
        disabled={!ready}
        onClick={() => onTogglePlay(source.id)}
      >
        {playing ? <Pause size={ICON} aria-hidden="true" fill="currentColor" /> : <Play size={ICON} aria-hidden="true" fill="currentColor" />}
      </button>
    </div>
  );
}

/** The marked part of the clip, as a bar along the bottom of its thumbnail. */
function MarkedSpan({ marks, frames }: { marks: Marks; frames: Frames }) {
  const start = (marks.in ?? 0) / frames;
  const end = ((marks.out ?? frames - 1) + 1) / frames;
  return <span className="library-marks" style={{ left: `${start * 100}%`, width: `${(end - start) * 100}%` }} aria-hidden="true" />;
}
