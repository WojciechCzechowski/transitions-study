import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type Ref,
} from 'react';
import { getPreset } from '../config/transitions.config';
import { trimClip, trimLimitTransition, type TrimEdge, type TrimResult } from '../model/ops';
import {
  clipStarts,
  cuts,
  getLimits,
  timelineLength,
  transitionAt,
  visibleLength,
  type ClampResult,
  type Doc,
  type Room,
} from '../model/timeline';
import { boundaryFrame, cutAtFrame, insertionIndex, rulerLabel, tickStep } from '../model/timelineView';
import { clamp, formatClock, FPS, formatTimecode, type Frames } from '../model/time';
import { ClipItem, trimLimitText, type TrimFeedback } from './ClipItem';
import { CutZone } from './CutZone';
import { useElementWidth } from './hooks';
import { TransitionItem, type Gesture } from './TransitionItem';

export type Selection = { readonly kind: 'clip' | 'transition'; readonly id: string } | null;

/** Hit-testing for drags that start outside the timeline (Library cards). */
export interface TimelineApi {
  /** Insertion index under the pointer, or null when it's not over the timeline. */
  hit(clientX: number, clientY: number): number | null;
  /** Key of the cut a preset dropped here would land on, or null. */
  hitCut(clientX: number, clientY: number): string | null;
}

/** How far (px) from a cut, or from its transition's edges, a preset drop still lands on it. */
const CUT_DROP_PX = 28;

/** Width of the placeholder at a cut picked with +: a marker only, not the transition's length. */
const PENDING_SLOT_FRAMES: Frames = 6;

interface Props {
  doc: Doc;
  playhead: Frames;
  ready: boolean;
  /** Pixels per frame from the zoom control (or fit-to-width). */
  ppf: number;
  selection: Selection;
  targetCutKey: string | null;
  /** A cut picked with + that has no transition yet; it gets a placeholder slot. */
  pendingCutKey: string | null;
  /** The Transitions picker is in use: show the target cut's handles. */
  pickerActive: boolean;
  pickerId: string;
  /** Insertion marker for a Library drag. */
  dropIndex: number | null;
  /** The cut under a preset drag, and whether it can take a transition. */
  dropCutKey: string | null;
  dropCutValid: boolean;
  /** Frames that applying a preset at this cut would trim off its clips, to shade them. */
  trimPreview: { readonly cutKey: string; readonly room: Room } | null;
  /** Focus targets the editor moves focus to. */
  cutEls: Map<string, HTMLButtonElement>;
  transitionEls: Map<string, HTMLButtonElement>;
  apiRef: Ref<TimelineApi>;
  sourceTone: (sourceId: string) => number;
  onViewportWidth: (width: number) => void;
  onScrubStart: () => void;
  onScrub: (frame: Frames) => void;
  onSelect: (selection: Selection) => void;
  onChooseAtCut: (cutKey: string) => void;
  gesture: Gesture;
  onStepDuration: (cutKey: string, requested: Frames) => { readonly clamped: ClampResult['clamped'] };
  onMoveClip: (clipId: string, toIndex: number) => void;
  onNudgeClip: (clipId: string, delta: -1 | 1) => void;
  /** Keyboard trim: commit one step. */
  onTrimStep: (clipId: string, edge: TrimEdge, requested: Frames) => TrimResult;
  announce: (text: string) => void;
}

/** Space after the last clip, so there's room to drop at the end. */
const END_ROOM_PX = 160;

export function Timeline(props: Props) {
  const { doc, playhead, ready, selection, targetCutKey, pickerActive } = props;
  const [scrollRef, viewportWidth] = useElementWidth<HTMLDivElement>();
  const innerRef = useRef<HTMLDivElement>(null);
  const scrollEl = useRef<HTMLDivElement | null>(null);

  // Freeze the scale while a gesture runs, so the length changing under a trim doesn't rescale it.
  const [frozenPpf, setFrozenPpf] = useState<number | null>(null);
  const ppf = frozenPpf ?? props.ppf;
  const freeze = (on: boolean) => setFrozenPpf(on ? ppf : null);

  const len = timelineLength(doc);
  const starts = clipStarts(doc);
  const cutList = cuts(doc);
  const x = (f: number) => f * ppf;

  const [hoverCut, setHoverCut] = useState<string | null>(null);
  const [focusCut, setFocusCut] = useState<string | null>(null);
  const [engagedCut, setEngagedCut] = useState<string | null>(null);
  const [move, setMove] = useState<{ clipId: string; index: number } | null>(null);
  const [trimLive, setTrimLive] = useState<(TrimFeedback & { clipId: string }) | null>(null);
  const [trimFocus, setTrimFocus] = useState<{ clipId: string; edge: TrimEdge; reason: string | null } | null>(null);
  const trimBase = useRef<Doc | null>(null);
  const scrubbing = useRef(false);
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });

  useEffect(() => {
    latest.current.onViewportWidth(Math.max(0, viewportWidth - 24));
  }, [viewportWidth]);

  const frameAtClientX = (clientX: number) => {
    const rect = innerRef.current?.getBoundingClientRect();
    return rect ? (clientX - rect.left) / (ppf || 1) : 0;
  };

  const overTimeline = (clientX: number, clientY: number) => {
    const el = scrollEl.current;
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  };

  useImperativeHandle(props.apiRef, () => ({
    hit(clientX, clientY) {
      if (!overTimeline(clientX, clientY)) return null;
      return insertionIndex(latest.current.doc, frameAtClientX(clientX));
    },
    hitCut(clientX, clientY) {
      if (!overTimeline(clientX, clientY)) return null;
      return cutAtFrame(latest.current.doc, frameAtClientX(clientX), CUT_DROP_PX / (ppf || 1))?.key ?? null;
    },
  }));

  // --- ruler ------------------------------------------------------------------

  const frameAt = (clientX: number) => clamp(Math.round(frameAtClientX(clientX)), 0, Math.max(0, len - 1));

  const onRulerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    scrubbing.current = true;
    props.onScrubStart();
    props.onScrub(frameAt(e.clientX));
  };
  const onRulerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (scrubbing.current) props.onScrub(frameAt(e.clientX));
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
    props.onScrub(clamp(next, 0, Math.max(0, len - 1)));
  };

  // Keep the playhead in view while playing or stepping.
  useEffect(() => {
    const el = scrollEl.current;
    if (!el) return;
    const px = playhead * ppf;
    if (px < el.scrollLeft || px > el.scrollLeft + el.clientWidth - 24) el.scrollLeft = Math.max(0, px - el.clientWidth / 3);
  }, [playhead, ppf]);

  // --- reorder ----------------------------------------------------------------

  const onMoveStart = (clipId: string) => {
    props.onScrubStart();
    freeze(true);
    setMove({ clipId, index: insertionIndex(doc, playhead) });
    props.onSelect({ kind: 'clip', id: clipId });
  };
  const onMove = (clientX: number) => {
    const index = insertionIndex(latest.current.doc, frameAtClientX(clientX));
    setMove((m) => (m ? { ...m, index } : m));
  };
  const onMoveEnd = (commit: boolean) => {
    const m = move;
    setMove(null);
    freeze(false);
    if (commit && m) props.onMoveClip(m.clipId, m.index);
  };

  // --- trim -------------------------------------------------------------------

  const trimReason = (base: Doc, clipId: string, edge: TrimEdge, r: TrimResult) => {
    const t = r.limit ? trimLimitTransition(base, clipId, edge, r.limit) : null;
    return trimLimitText(r.limit, t ? getPreset(t.presetId).name : null);
  };

  const onTrimStart = (clipId: string) => {
    props.onScrubStart();
    trimBase.current = doc;
    freeze(true);
    props.onSelect({ kind: 'clip', id: clipId });
    props.gesture.begin();
  };
  const onTrimMove = (clipId: string, edge: TrimEdge, requested: Frames) => {
    const base = trimBase.current;
    if (!base) return;
    const r = trimClip(base, clipId, edge, requested);
    const clip = r.doc.clips.find((c) => c.id === clipId);
    setTrimLive({ clipId, edge, length: clip ? visibleLength(clip) : 0, reason: trimReason(base, clipId, edge, r) });
    props.gesture.update(r.doc);
  };
  const onTrimEnd = (commit: boolean) => {
    const base = trimBase.current;
    if (!base) return;
    const clipId = trimLive?.clipId;
    trimBase.current = null;
    setTrimLive(null);
    freeze(false);
    if (commit) {
      const label = base.clips.find((c) => c.id === clipId)?.label ?? 'clip';
      props.gesture.end(`Trim ${label}`);
    } else {
      props.gesture.cancel();
    }
  };

  // Escape cancels a pointer trim or a reorder.
  const moving = move !== null;
  const trimming = trimLive !== null;
  useEffect(() => {
    if (!trimming && !moving) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      if (trimBase.current) {
        trimBase.current = null;
        setTrimLive(null);
        setFrozenPpf(null);
        latest.current.gesture.cancel();
        latest.current.announce('Trim cancelled');
      }
      setMove((m) => {
        if (m) latest.current.announce('Move cancelled');
        return null;
      });
      setFrozenPpf(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [trimming, moving]);

  const onTrimStep = (clipId: string, edge: TrimEdge, requested: Frames) => {
    const r = props.onTrimStep(clipId, edge, requested);
    const reason = trimReason(doc, clipId, edge, r);
    setTrimFocus({ clipId, edge, reason });
    if (reason) props.announce(reason);
  };

  // --- render -------------------------------------------------------------------

  const { major, minor } = tickStep(ppf);
  const innerWidth = Math.max(x(len) + END_ROOM_PX, viewportWidth);
  const ticks: { f: number; major: boolean }[] = [];
  if (ppf > 0) {
    const lastFrame = Math.ceil(innerWidth / ppf);
    for (let f = 0; f <= lastFrame; f += minor) ticks.push({ f, major: f % major === 0 });
  }

  const markerIndex = move ? move.index : props.dropIndex;
  /** "00:02:08": the seconds part reads dark, the frames part muted. */
  const gutterTime = formatTimecode(playhead);
  const trimFeedbackFor = (clipId: string): TrimFeedback | null => {
    if (trimLive?.clipId === clipId) return trimLive;
    if (trimFocus?.clipId === clipId) {
      const clip = doc.clips.find((c) => c.id === clipId);
      return clip ? { edge: trimFocus.edge, length: visibleLength(clip), reason: trimFocus.reason } : null;
    }
    return null;
  };

  return (
    <div className="timeline">
      <div className="track-headers" aria-hidden="true">
        <div className="track-header-ruler">
          {gutterTime.slice(0, -3)}
          <span className="muted">{gutterTime.slice(-3)}</span>
        </div>
        <div className="lane-area">
          <div className="track-header">V1</div>
        </div>
      </div>
      <div
        className="timeline-scroll"
        ref={(el) => {
          scrollEl.current = el;
          scrollRef(el);
        }}
      >
        <div className="timeline-inner" ref={innerRef} style={{ width: innerWidth }}>
          <div
            className="ruler"
            role="slider"
            tabIndex={0}
            aria-label="Playhead"
            aria-valuemin={0}
            aria-valuemax={Math.max(0, len - 1)}
            aria-valuenow={playhead}
            aria-valuetext={`Frame ${playhead}, ${formatTimecode(playhead)}`}
            onPointerDown={onRulerDown}
            onPointerMove={onRulerMove}
            onPointerUp={onRulerUp}
            onPointerCancel={onRulerUp}
            onKeyDown={onRulerKey}
          >
            {ticks.map(({ f, major: isMajor }) => (
              <div key={f} className={`tick${isMajor ? ' major' : ''}`} style={{ left: x(f) }}>
                {isMajor && f > 0 && <span>{rulerLabel(f, major)}</span>}
              </div>
            ))}
          </div>

          {/* Space around the lane: clicking it deselects, like the lane's own empty space. */}
          <div
            className="lane-area"
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) props.onSelect(null);
            }}
          >
            <div
              className="track"
              role="group"
              aria-label="Video track V1"
              onPointerDown={(e) => {
                if (e.target === e.currentTarget) props.onSelect(null);
              }}
            >
              {doc.clips.length === 0 && <p className="track-empty">Drag a clip here from the Library</p>}
              {doc.clips.map((clip, i) => (
                <ClipItem
                  key={clip.id}
                  clip={clip}
                  index={i}
                  left={x(starts[i]!)}
                  width={x(visibleLength(clip))}
                  tone={props.sourceTone(clip.sourceId)}
                  selected={selection?.kind === 'clip' && selection.id === clip.id}
                  trim={trimFeedbackFor(clip.id)}
                  ppf={ppf}
                  onSelect={() => props.onSelect({ kind: 'clip', id: clip.id })}
                  onMoveStart={onMoveStart}
                  onMove={onMove}
                  onMoveEnd={onMoveEnd}
                  onNudge={props.onNudgeClip}
                  onTrimStart={onTrimStart}
                  onTrimMove={onTrimMove}
                  onTrimEnd={onTrimEnd}
                  onTrimStep={onTrimStep}
                  onTrimFocus={(clipId, edge) => {
                    if (!edge) setTrimFocus((f) => (f?.clipId === clipId ? null : f));
                  }}
                />
              ))}

              {cutList.map((cut) => {
                const t = transitionAt(doc, cut.key);
                const limits = getLimits(doc, cut);
                const dropHere = props.dropCutKey === cut.key;
                const showStrips =
                  dropHere ||
                  hoverCut === cut.key ||
                  focusCut === cut.key ||
                  engagedCut === cut.key ||
                  (pickerActive && targetCutKey === cut.key);
                const aTail = limits.available.aTail;
                const bHead = limits.available.bHead;
                const half = t ? t.duration / 2 : 0;
                return (
                  <div
                    key={cut.key}
                    className={`cut-layer${dropHere ? (props.dropCutValid ? ' drop-target' : ' drop-invalid') : ''}`}
                  >
                    {showStrips && (
                      <>
                        <div
                          className={`handle-strip strip-a${aTail === 0 ? ' empty' : ''}`}
                          style={{ left: x(cut.frame), width: Math.max(2, x(Math.min(aTail, len - cut.frame))) }}
                        >
                          <span>
                            {cut.from.label} tail · {aTail} f
                          </span>
                        </div>
                        <div
                          className={`handle-strip strip-b${bHead === 0 ? ' empty' : ''}`}
                          style={{ left: x(cut.frame - Math.min(bHead, cut.frame)), width: Math.max(2, x(Math.min(bHead, cut.frame))) }}
                        >
                          <span>
                            {cut.to.label} head · {bHead} f
                          </span>
                        </div>
                      </>
                    )}
                    {props.trimPreview?.cutKey === cut.key && (
                      <>
                        {props.trimPreview.room.a > 0 && (
                          <div
                            className="trim-preview"
                            style={{ left: x(cut.frame - props.trimPreview.room.a), width: x(props.trimPreview.room.a) }}
                            aria-hidden="true"
                          >
                            <span>−{props.trimPreview.room.a} f</span>
                          </div>
                        )}
                        {props.trimPreview.room.b > 0 && (
                          <div
                            className="trim-preview"
                            style={{ left: x(cut.frame), width: x(props.trimPreview.room.b) }}
                            aria-hidden="true"
                          >
                            <span>−{props.trimPreview.room.b} f</span>
                          </div>
                        )}
                      </>
                    )}
                    {t ? (
                      <TransitionItem
                        doc={doc}
                        cut={cut}
                        transition={t}
                        limits={limits}
                        ppf={ppf}
                        left={x(cut.frame - half)}
                        width={x(t.duration)}
                        selected={selection?.kind === 'transition' && selection.id === t.id}
                        bodyRef={(el) => {
                          if (el) props.transitionEls.set(t.id, el);
                          else props.transitionEls.delete(t.id);
                        }}
                        gesture={props.gesture}
                        onSelect={() => props.onSelect({ kind: 'transition', id: t.id })}
                        onGestureActive={freeze}
                        onEngaged={(on) => setEngagedCut((k) => (on ? cut.key : k === cut.key ? null : k))}
                        onStepDuration={(requested) => props.onStepDuration(cut.key, requested)}
                        announce={props.announce}
                      />
                    ) : (
                      <>
                        {props.pendingCutKey === cut.key && (
                          <div
                            className="transition-slot"
                            style={{ left: x(cut.frame), width: x(PENDING_SLOT_FRAMES) }}
                            aria-hidden="true"
                          />
                        )}
                        <CutZone
                          cut={cut}
                          left={x(cut.frame)}
                          ready={ready}
                          engaged={(pickerActive && targetCutKey === cut.key) || (dropHere && props.dropCutValid)}
                          pickerId={props.pickerId}
                          buttonRef={(el) => {
                            if (el) props.cutEls.set(cut.key, el);
                            else props.cutEls.delete(cut.key);
                          }}
                          onHover={(on) => setHoverCut((k) => (on ? cut.key : k === cut.key ? null : k))}
                          onFocusChange={(on) => setFocusCut((k) => (on ? cut.key : k === cut.key ? null : k))}
                          onChoose={() => props.onChooseAtCut(cut.key)}
                        />
                      </>
                    )}
                  </div>
                );
              })}

              {markerIndex !== null && (
                <div className="insert-marker" style={{ left: x(boundaryFrame(doc, markerIndex)) }} aria-hidden="true" />
              )}
            </div>
          </div>

          <div
            className="playhead"
            style={{ left: x(playhead), '--playhead-x': `${x(playhead)}px` } as CSSProperties}
            aria-hidden="true"
          >
            <span className="playhead-label">{formatClock(playhead)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
