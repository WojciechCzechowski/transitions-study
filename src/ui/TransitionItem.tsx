import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type Ref } from 'react';
import { getPreset } from '../config/transitions.config';
import { dragDuration, type Edge } from '../model/dragDuration';
import { describeLimit, describeMinimum } from '../model/messages';
import { setDuration } from '../model/ops';
import type { ClampResult, Cut, Doc, Limits, Transition } from '../model/timeline';
import { formatDuration, FPS, type Frames } from '../model/time';

export interface Gesture {
  begin: () => void;
  update: (doc: Doc) => void;
  end: (label: string) => void;
  cancel: () => void;
}

interface Props {
  doc: Doc;
  cut: Cut;
  transition: Transition;
  limits: Limits;
  /** Pixels per frame (frozen by the parent during gestures). */
  ppf: number;
  left: number;
  width: number;
  selected: boolean;
  bodyRef?: Ref<HTMLButtonElement>;
  gesture: Gesture;
  onSelect: () => void;
  /** Freeze/unfreeze the timeline scale around an edge drag. */
  onGestureActive: (active: boolean) => void;
  /** The handle strips should show (edge focused or dragged). */
  onEngaged: (engaged: boolean) => void;
  /** Discrete duration change (keyboard). Returns how it was clamped. */
  onStepDuration: (requested: Frames) => { readonly clamped: ClampResult['clamped'] };
  announce: (text: string) => void;
}

interface DragState {
  edge: Edge;
  pointerId: number;
  startX: number;
  startDuration: Frames;
  baseDoc: Doc;
  announcedLimit: boolean;
}

/** A transition on one cut: click selects, the edges resize it symmetrically. */
export function TransitionItem(props: Props) {
  const { doc, cut, transition: t, limits, ppf, left, width, selected } = props;
  const [dragEdge, setDragEdge] = useState<Edge | null>(null);
  const [edgeFocused, setEdgeFocused] = useState<Edge | null>(null);
  const [limitHit, setLimitHit] = useState<ClampResult['clamped']>(null);
  const drag = useRef<DragState | null>(null);
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });

  const engaged = dragEdge !== null || edgeFocused !== null;
  useEffect(() => {
    latest.current.onEngaged(engaged);
  }, [engaged]);

  // Escape cancels an edge drag and restores the duration from before it.
  useEffect(() => {
    if (!dragEdge) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || !drag.current) return;
      e.preventDefault();
      e.stopPropagation();
      drag.current = null;
      setDragEdge(null);
      setLimitHit(null);
      latest.current.gesture.cancel();
      latest.current.onGestureActive(false);
      latest.current.announce('Duration change cancelled');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [dragEdge]);

  const onEdgeDown = (edge: Edge) => (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus({ preventScroll: true });
    drag.current = { edge, pointerId: e.pointerId, startX: e.clientX, startDuration: t.duration, baseDoc: doc, announcedLimit: false };
    setDragEdge(edge);
    setLimitHit(null);
    props.onSelect();
    props.onGestureActive(true);
    props.gesture.begin();
  };

  const onEdgeMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const r = dragDuration(d.startDuration, d.edge, e.clientX - d.startX, ppf, limits);
    setLimitHit(r.clamped);
    if (r.clamped === 'max' && !d.announcedLimit) {
      d.announcedLimit = true;
      props.announce(describeLimit(cut, limits));
    }
    if (r.clamped !== 'max') d.announcedLimit = false;
    props.gesture.update(setDuration(d.baseDoc, cut.key, r.duration).doc);
  };

  const onEdgeUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    drag.current = null;
    setDragEdge(null);
    setLimitHit(null);
    props.gesture.end('Change duration');
    props.onGestureActive(false);
  };

  const onEdgeKey = (edge: Edge) => (e: KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 2;
    const outward = edge === 'right' ? 'ArrowRight' : 'ArrowLeft';
    const inward = edge === 'right' ? 'ArrowLeft' : 'ArrowRight';
    let requested: number | null = null;
    if (e.key === outward || e.key === 'ArrowUp') requested = t.duration + step;
    else if (e.key === inward || e.key === 'ArrowDown') requested = t.duration - step;
    else if (e.key === 'Home') requested = limits.min;
    else if (e.key === 'End') requested = limits.max;
    if (requested === null) return;
    e.preventDefault();
    e.stopPropagation();
    const r = props.onStepDuration(requested);
    setLimitHit(r.clamped);
    if (r.clamped === 'max') props.announce(describeLimit(cut, limits));
    else if (r.clamped === 'min') props.announce(describeMinimum(limits));
  };

  const name = getPreset(t.presetId).name;
  const showTooltip = dragEdge !== null || edgeFocused !== null;
  const reason = limitHit === 'max' ? describeLimit(cut, limits) : limitHit === 'min' ? describeMinimum(limits) : null;

  return (
    <>
      {dragEdge && limits.canTransition && (
        <div
          className="max-reach"
          style={{ left: (cut.frame - limits.max / 2) * ppf, width: limits.max * ppf }}
          aria-hidden="true"
        />
      )}
      <div
        className={`transition-object${selected ? ' selected' : ''}${dragEdge ? ' dragging' : ''}${limitHit === 'max' ? ' at-limit' : ''}`}
        style={{ left, width }}
      >
        <button
          ref={props.bodyRef}
          type="button"
          className="transition-body"
          aria-pressed={selected}
          aria-label={`${name} transition between ${cut.from.label} and ${cut.to.label}, ${formatDuration(t.duration)}, centred on the cut. Delete removes it.`}
          onFocus={props.onSelect}
          onClick={props.onSelect}
        >
          <span className="transition-label">
            {name} · {t.duration} f
          </span>
        </button>
        {(['left', 'right'] as const).map((edge) => (
          <div
            key={edge}
            className={`edge edge-${edge}`}
            role="slider"
            tabIndex={0}
            aria-label={`${name} ${edge === 'left' ? 'start' : 'end'} edge (duration)`}
            aria-valuemin={limits.min}
            aria-valuemax={limits.max}
            aria-valuenow={t.duration}
            aria-valuetext={`${t.duration} frames, ${(t.duration / FPS).toFixed(2)} seconds`}
            onPointerDown={onEdgeDown(edge)}
            onPointerMove={onEdgeMove}
            onPointerUp={onEdgeUp}
            onPointerCancel={onEdgeUp}
            onKeyDown={onEdgeKey(edge)}
            onFocus={() => {
              setEdgeFocused(edge);
              props.onSelect();
            }}
            onBlur={() => {
              setEdgeFocused(null);
              setLimitHit(null);
            }}
          />
        ))}
        {showTooltip && (
          <div className={`tooltip${limitHit ? ' warn' : ''}`} role="status">
            <strong>{formatDuration(t.duration)}</strong>
            {reason && <span>{reason}</span>}
          </div>
        )}
      </div>
    </>
  );
}
