import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { pxToFrames } from '../model/dragDuration';
import type { TrimEdge, TrimLimit } from '../model/ops';
import type { Clip } from '../model/timeline';
import { visibleLength } from '../model/timeline';
import { formatDuration, type Frames } from '../model/time';
import { ClipInfo } from './ClipInfo';
import { Filmstrip } from './Filmstrip';

/** Narrower than this, the selected clip has no room for its info badge. */
const INFO_MIN_WIDTH = 44;
/** Narrower than this, the clip's name is hidden. */
const NAME_MIN_WIDTH = 56;

export interface TrimFeedback {
  readonly edge: TrimEdge;
  readonly length: Frames;
  readonly reason: string | null;
}

interface Props {
  clip: Clip;
  index: number;
  left: number;
  width: number;
  /** Colour slot for the clip's source (0 = first library clip). */
  tone: number;
  selected: boolean;
  /** Live trim tooltip for this clip, if a trim is in progress or at a limit. */
  trim: TrimFeedback | null;
  /** Pixels per frame, frozen by the parent during gestures. */
  ppf: number;
  onSelect: () => void;
  /** Reorder: pointer travel past the threshold starts it; the parent tracks the drop point. */
  onMoveStart: (clipId: string, pointerId: number) => void;
  onMove: (clientX: number) => void;
  onMoveEnd: (commit: boolean) => void;
  /** Keyboard reorder by one position. */
  onNudge: (clipId: string, delta: -1 | 1) => void;
  onTrimStart: (clipId: string, edge: TrimEdge) => void;
  /** Requested source frame for the edge (sourceIn or sourceOut). */
  onTrimMove: (clipId: string, edge: TrimEdge, requested: Frames) => void;
  onTrimEnd: (commit: boolean) => void;
  /** Keyboard trim: commits right away. */
  onTrimStep: (clipId: string, edge: TrimEdge, requested: Frames) => void;
  onTrimFocus: (clipId: string, edge: TrimEdge | null) => void;
}

const MOVE_THRESHOLD_PX = 4;

export function trimLimitText(limit: TrimLimit | null, transitionName: string | null): string | null {
  switch (limit) {
    case 'source-start':
      return 'Start of the source clip';
    case 'source-end':
      return 'End of the source clip';
    case 'edge-transition':
      return `Limited by ${transitionName ?? 'the transition'} (needs 1 frame of handle)`;
    case 'other-transition':
      return `Limited by ${transitionName ?? 'the transition'} at the other end`;
    case 'min-length':
      return 'Minimum length: 1 frame';
    default:
      return null;
  }
}

/**
 * One clip on the magnetic track. Click selects; dragging the body reorders;
 * the grips at both ends trim (pointer or arrow keys) and later clips shift.
 */
export function ClipItem(props: Props) {
  const { clip, left, width, tone, selected, trim, ppf } = props;
  const press = useRef<{ pointerId: number; x: number; moving: boolean } | null>(null);
  const trimDrag = useRef<{ edge: TrimEdge; pointerId: number; x: number; start: Frames } | null>(null);
  const [moving, setMoving] = useState(false);

  // --- body: select / reorder ---------------------------------------------------

  const onBodyDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current = { pointerId: e.pointerId, x: e.clientX, moving: false };
  };
  const onBodyMove = (e: PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p || p.pointerId !== e.pointerId) return;
    if (!p.moving && Math.abs(e.clientX - p.x) >= MOVE_THRESHOLD_PX) {
      p.moving = true;
      setMoving(true);
      props.onMoveStart(clip.id, e.pointerId);
    }
    if (p.moving) props.onMove(e.clientX);
  };
  const onBodyUp = (e: PointerEvent<HTMLDivElement>, cancelled = false) => {
    const p = press.current;
    if (!p || p.pointerId !== e.pointerId) return;
    press.current = null;
    if (p.moving) {
      setMoving(false);
      props.onMoveEnd(!cancelled);
    } else if (!cancelled) {
      props.onSelect();
    }
  };
  const onBodyKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      props.onNudge(clip.id, e.key === 'ArrowLeft' ? -1 : 1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      props.onSelect();
    }
  };

  // --- grips: trim ---------------------------------------------------------------

  const edgeValue = (edge: TrimEdge) => (edge === 'start' ? clip.sourceIn : clip.sourceOut);

  const onGripDown = (edge: TrimEdge) => (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus({ preventScroll: true });
    trimDrag.current = { edge, pointerId: e.pointerId, x: e.clientX, start: edgeValue(edge) };
    props.onTrimStart(clip.id, edge);
  };
  const onGripMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = trimDrag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    props.onTrimMove(clip.id, d.edge, d.start + pxToFrames(e.clientX - d.x, ppf));
  };
  const onGripUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = trimDrag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    trimDrag.current = null;
    props.onTrimEnd(true);
  };
  const onGripKey = (edge: TrimEdge) => (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 10 : 1;
    let delta: number | null = null;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') delta = -step;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') delta = step;
    if (delta === null) return;
    e.preventDefault();
    e.stopPropagation();
    props.onTrimStep(clip.id, edge, edgeValue(edge) + delta);
  };

  const len = visibleLength(clip);

  return (
    <div
      className={`clip tone-${tone % 4}${selected ? ' selected' : ''}${moving ? ' moving' : ''}`}
      style={{ left, width }}
    >
      <div
        className="clip-body"
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        aria-label={`${clip.label}, ${formatDuration(len)}, source frames ${clip.sourceIn} to ${clip.sourceOut - 1}. Alt+arrows move it, Delete removes it.`}
        onPointerDown={onBodyDown}
        onPointerMove={onBodyMove}
        onPointerUp={(e) => onBodyUp(e)}
        onPointerCancel={(e) => onBodyUp(e, true)}
        onKeyDown={onBodyKey}
        onFocus={props.onSelect}
      >
        <Filmstrip sourceId={clip.sourceId} sourceIn={clip.sourceIn} sourceOut={clip.sourceOut} width={width} ppf={ppf} />
        {width >= NAME_MIN_WIDTH && (
          <span className="clip-name" aria-hidden="true">
            {clip.label}
          </span>
        )}
      </div>
      {selected && width >= INFO_MIN_WIDTH && <ClipInfo clip={clip} length={len} />}
      {(['start', 'end'] as const).map((edge) => (
        <div
          key={edge}
          className={`trim-grip grip-${edge}`}
          role="slider"
          tabIndex={0}
          aria-label={`Trim ${clip.label} ${edge === 'start' ? 'start' : 'end'}`}
          aria-valuemin={0}
          aria-valuemax={clip.sourceFrames}
          aria-valuenow={edgeValue(edge)}
          aria-valuetext={`${edge === 'start' ? 'In' : 'Out'} at source frame ${edgeValue(edge)}, ${len} frames long`}
          onPointerDown={onGripDown(edge)}
          onPointerMove={onGripMove}
          onPointerUp={onGripUp}
          onPointerCancel={onGripUp}
          onKeyDown={onGripKey(edge)}
          onFocus={() => props.onTrimFocus(clip.id, edge)}
          onBlur={() => props.onTrimFocus(clip.id, null)}
        />
      ))}
      {trim && (
        <div className={`tooltip clip-tooltip${trim.reason ? ' warn' : ''}`} role="status">
          <strong>{formatDuration(trim.length)}</strong>
          {trim.reason && <span>{trim.reason}</span>}
        </div>
      )}
    </div>
  );
}
