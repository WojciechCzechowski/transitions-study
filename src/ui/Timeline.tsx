import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type Ref } from 'react';
import { getPreset } from '../config/transitions.config';
import { dragDuration, type Edge } from '../model/dragDuration';
import { describeLimit, describeMinimum } from '../model/messages';
import { setDuration } from '../model/ops';
import {
  cutFrame,
  timelineLength,
  visibleLength,
  type ClampResult,
  type Clip,
  type Doc,
  type Limits,
} from '../model/timeline';
import { clamp, formatDuration, formatTimecode, FPS, type Frames } from '../model/time';
import { useElementWidth } from './hooks';

interface Props {
  doc: Doc;
  limits: Limits;
  playhead: Frames;
  ready: boolean;
  selected: boolean;
  galleryOpen: boolean;
  cutHandleRef: Ref<HTMLButtonElement>;
  transitionRef: Ref<HTMLButtonElement>;
  onScrubStart: () => void;
  onScrub: (frame: Frames) => void;
  onSelect: (selected: boolean) => void;
  onOpenGallery: () => void;
  gesture: {
    begin: () => void;
    update: (doc: Doc) => void;
    end: (label: string) => void;
    cancel: () => void;
  };
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

export function Timeline(props: Props) {
  const { doc, limits, playhead, ready, selected, galleryOpen } = props;
  const [innerRef, width] = useElementWidth<HTMLDivElement>();
  const len = timelineLength(doc);
  const ppf = width > 0 ? width / len : 0;
  const cut = cutFrame(doc);
  const x = (f: number) => f * ppf;

  const [hoverCut, setHoverCut] = useState(false);
  const [cutFocused, setCutFocused] = useState(false);
  const [edgeFocused, setEdgeFocused] = useState<Edge | null>(null);
  const [limitHit, setLimitHit] = useState<ClampResult['clamped']>(null);
  const [dragEdge, setDragEdge] = useState<Edge | null>(null);
  const drag = useRef<DragState | null>(null);
  const scrubbing = useRef(false);
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });

  const t = doc.transition;
  const showHandles = hoverCut || cutFocused || galleryOpen || dragEdge !== null || edgeFocused !== null;

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
      latest.current.announce('Duration change cancelled');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [dragEdge]);

  // --- ruler ------------------------------------------------------------------

  const frameAt = (clientX: number, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    return clamp(Math.round((clientX - rect.left) / (ppf || 1)), 0, len - 1);
  };

  const onRulerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    scrubbing.current = true;
    props.onScrubStart();
    props.onScrub(frameAt(e.clientX, e.currentTarget));
  };
  const onRulerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (scrubbing.current) props.onScrub(frameAt(e.clientX, e.currentTarget));
  };
  const onRulerUp = () => {
    scrubbing.current = false;
  };
  const onRulerKey = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 1;
    const next =
      e.key === 'ArrowLeft' || e.key === 'ArrowDown'
        ? playhead - step
        : e.key === 'ArrowRight' || e.key === 'ArrowUp'
          ? playhead + step
          : e.key === 'PageUp'
            ? playhead - FPS
            : e.key === 'PageDown'
              ? playhead + FPS
              : e.key === 'Home'
                ? 0
                : e.key === 'End'
                  ? len - 1
                  : null;
    if (next === null) return;
    e.preventDefault();
    props.onScrubStart();
    props.onScrub(clamp(next, 0, len - 1));
  };

  // --- edges ------------------------------------------------------------------

  const onEdgeDown = (edge: Edge) => (e: PointerEvent<HTMLDivElement>) => {
    if (!t || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus({ preventScroll: true });
    drag.current = { edge, pointerId: e.pointerId, startX: e.clientX, startDuration: t.duration, baseDoc: doc, announcedLimit: false };
    setDragEdge(edge);
    setLimitHit(null);
    props.onSelect(true);
    props.gesture.begin();
  };

  const onEdgeMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const r = dragDuration(d.startDuration, d.edge, e.clientX - d.startX, ppf, limits);
    setLimitHit(r.clamped);
    if (r.clamped === 'max' && !d.announcedLimit) {
      d.announcedLimit = true;
      props.announce(describeLimit(doc, limits));
    }
    if (r.clamped !== 'max') d.announcedLimit = false;
    props.gesture.update(setDuration(d.baseDoc, r.duration).doc);
  };

  const onEdgeUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    drag.current = null;
    setDragEdge(null);
    setLimitHit(null);
    props.gesture.end('Change duration');
  };

  const onEdgeKey = (edge: Edge) => (e: KeyboardEvent) => {
    if (!t) return;
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
    const r = props.onStepDuration(requested);
    setLimitHit(r.clamped);
    if (r.clamped === 'max') props.announce(describeLimit(doc, limits));
    else if (r.clamped === 'min') props.announce(describeMinimum(limits));
  };

  // --- render -------------------------------------------------------------------

  const ticks: { f: number; major: boolean }[] = [];
  for (let f = 0; f <= len; f += 5) ticks.push({ f, major: f % FPS === 0 });

  const aTail = limits.available.aTail;
  const bHead = limits.available.bHead;
  const half = t ? t.duration / 2 : 0;
  const tooltip = t && (dragEdge || edgeFocused) ? tooltipText(doc, limits, t.duration, limitHit) : null;

  return (
    <div className="timeline">
      <div className="timeline-inner" ref={innerRef}>
        <div
          className="ruler"
          role="slider"
          tabIndex={0}
          aria-label="Playhead"
          aria-valuemin={0}
          aria-valuemax={len - 1}
          aria-valuenow={playhead}
          aria-valuetext={`Frame ${playhead}, ${formatTimecode(playhead)}`}
          onPointerDown={onRulerDown}
          onPointerMove={onRulerMove}
          onPointerUp={onRulerUp}
          onPointerCancel={onRulerUp}
          onKeyDown={onRulerKey}
        >
          {ppf > 0 &&
            ticks.map(({ f, major }) => (
              <div key={f} className={`tick${major ? ' major' : ''}`} style={{ left: x(f) }}>
                {major && <span>{f / FPS}s</span>}
              </div>
            ))}
        </div>

        <div
          className="track"
          onPointerDown={(e) => {
            const el = e.target as HTMLElement;
            if (el === e.currentTarget || el.closest('.clip')) props.onSelect(false);
          }}
        >
          {ppf > 0 && (
            <>
              <ClipBlock clip={doc.a} left={x(doc.a.start)} width={x(visibleLength(doc.a))} side="a" />
              <ClipBlock clip={doc.b} left={x(doc.b.start)} width={x(visibleLength(doc.b))} side="b" />

              {showHandles && (
                <>
                  <div
                    className={`handle-strip strip-a${aTail === 0 ? ' empty' : ''}`}
                    style={{ left: x(cut), width: Math.max(2, x(Math.min(aTail, len - cut))) }}
                  >
                    <span>{doc.a.label} tail handle · {aTail} f</span>
                  </div>
                  <div
                    className={`handle-strip strip-b${bHead === 0 ? ' empty' : ''}`}
                    style={{ left: x(cut - Math.min(bHead, cut)), width: Math.max(2, x(Math.min(bHead, cut))) }}
                  >
                    <span>{doc.b.label} head handle · {bHead} f</span>
                  </div>
                </>
              )}

              {dragEdge && limits.canTransition && (
                <div className="max-reach" style={{ left: x(cut - limits.max / 2), width: x(limits.max) }} aria-hidden="true" />
              )}

              {!t && (
                <div
                  className="cut-zone"
                  style={{ left: x(cut) }}
                  onPointerEnter={() => setHoverCut(true)}
                  onPointerLeave={() => setHoverCut(false)}
                >
                  <button
                    ref={props.cutHandleRef}
                    type="button"
                    className="cut-handle"
                    aria-label={ready ? 'Add transition at the cut' : 'Add transition at the cut (preparing frames)'}
                    aria-expanded={galleryOpen}
                    aria-disabled={!ready || undefined}
                    onFocus={() => setCutFocused(true)}
                    onBlur={() => setCutFocused(false)}
                    onClick={() => ready && props.onOpenGallery()}
                  >
                    <span aria-hidden="true">+</span>
                  </button>
                </div>
              )}

              {t && (
                <div
                  className={`transition-object${selected ? ' selected' : ''}${dragEdge ? ' dragging' : ''}${limitHit === 'max' ? ' at-limit' : ''}`}
                  style={{ left: x(cut - half), width: x(t.duration) }}
                >
                  <button
                    ref={props.transitionRef}
                    type="button"
                    className="transition-body"
                    aria-pressed={selected}
                    aria-label={`${getPreset(t.presetId).name} transition, ${formatDuration(t.duration)}, centred on the cut. Delete removes it.`}
                    onFocus={() => props.onSelect(true)}
                    onClick={() => props.onSelect(true)}
                  >
                    <span className="transition-label">
                      {getPreset(t.presetId).name} · {t.duration} f
                    </span>
                  </button>
                  {(['left', 'right'] as const).map((edge) => (
                    <div
                      key={edge}
                      className={`edge edge-${edge}`}
                      role="slider"
                      tabIndex={0}
                      aria-label={`Transition ${edge === 'left' ? 'start' : 'end'} edge (duration)`}
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
                        props.onSelect(true);
                      }}
                      onBlur={() => {
                        setEdgeFocused(null);
                        setLimitHit(null);
                      }}
                    />
                  ))}
                  {tooltip && (
                    <div className={`tooltip${limitHit ? ' warn' : ''}`} role="status">
                      <strong>{tooltip.value}</strong>
                      {tooltip.reason && <span>{tooltip.reason}</span>}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {ppf > 0 && <div className="playhead" style={{ left: x(playhead) }} aria-hidden="true" />}
      </div>
    </div>
  );
}

function tooltipText(doc: Doc, limits: Limits, duration: Frames, hit: ClampResult['clamped']) {
  return {
    value: formatDuration(duration),
    reason: hit === 'max' ? describeLimit(doc, limits) : hit === 'min' ? describeMinimum(limits) : null,
  };
}

function ClipBlock({ clip, left, width, side }: { clip: Clip; left: number; width: number; side: 'a' | 'b' }) {
  return (
    <div className={`clip clip-${side}`} style={{ left, width }}>
      <span className="clip-name">{clip.label}</span>
      <span className="clip-range">
        src {clip.sourceIn}–{clip.sourceOut - 1} of {clip.sourceFrames}
      </span>
    </div>
  );
}
