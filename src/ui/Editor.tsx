import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { BetweenVerticalStart, Minus, Pause, Play, Plus, Redo2, Scan, SquareSplitHorizontal, Undo2 } from 'lucide-react';
import { getPreset, PRESETS, TRANSITION_DEFAULTS } from '../config/transitions.config';
import type { FrameFeeder } from '../media/FrameFeeder';
import type { ThumbCache } from '../media/ThumbCache';
import type { Bezier } from '../model/easing';
import {
  beginGesture,
  canRedo,
  canUndo,
  cancelGesture,
  commit,
  createHistory,
  endGesture,
  redo,
  redoLabel,
  undo,
  undoLabel,
  updateGesture,
  type History,
} from '../model/history';
import { markedRange, markIn, markOut, NO_MARKS, type Marks } from '../model/marks';
import { describeLimit, describeNoHandles, describeRoom, describeTrim } from '../model/messages';
import {
  applyTransition,
  deleteClip,
  insertAtFrame,
  insertClipRange,
  moveClip,
  removeTransition,
  resetTuning,
  setDuration,
  setEasing,
  setFeel,
  setIntensity,
  splitClip,
  trimClip,
  type SplitResult,
  type TrimEdge,
} from '../model/ops';
import {
  clampDuration,
  clipIndexById,
  cutByKey,
  cuts,
  docEquals,
  getLimits,
  NO_ROOM,
  roomFor,
  timelineLength,
  transitionAt,
  transitionById,
  transitionCutKey,
  type Cut,
  type Doc,
  type Room,
  type Source,
} from '../model/timeline';
import { clampZoom, fitScale, sliderToZoom, zoomToSlider } from '../model/timelineView';
import { formatClock, formatDuration, formatTimecode, type Frames } from '../model/time';
import type { PreviewCandidate, PreviewController } from '../playback/PreviewController';
import { Gallery } from './Gallery';
import { isMac, isTextEntry, modKey } from './hooks';
import { LibraryPanel, type ShownSource } from './LibraryPanel';
import { SourceControls } from './SourceControls';
import { ThumbsContext } from './Filmstrip';
import { Timeline, type Selection, type TimelineApi } from './Timeline';
import { TransitionPopover } from './TransitionPopover';
import { TransitionsPanel } from './TransitionsPanel';

interface Props {
  baseDoc: Doc;
  sources: readonly Source[];
  /** Decodes Library posters; null while the clips load. */
  feeder: FrameFeeder | null;
  /** Timeline filmstrip thumbnails; null while the clips load. */
  thumbs: ThumbCache | null;
  controller: PreviewController;
  ready: boolean;
  reducedMotion: boolean;
  announce: (text: string) => void;
  /** Shell slots this editor renders into. */
  sidebarEl: HTMLElement;
  timelineEl: HTMLElement;
  /** Layer over the preview canvas, for the Library clip controls. */
  previewEl: HTMLElement;
}

type Tab = 'library' | 'transitions';
type FocusTarget =
  | { kind: 'cut'; key: string }
  | { kind: 'transition'; id: string }
  | { kind: 'picker' }
  | { kind: 'edit' };

/** A preset tile being dragged toward the timeline; `cutKey` is the cut under the pointer. */
interface PresetDrag {
  readonly presetId: string;
  readonly x: number;
  readonly y: number;
  readonly cutKey: string | null;
}

const TAB_KEY = 'transition-study.tab';
const HOVER_PREVIEW_KEY = 'transition-study.preview-on-hover';

/** On unless the viewer turned it off. */
function readPreviewOnHover(): boolean {
  try {
    return localStorage.getItem(HOVER_PREVIEW_KEY) !== 'off';
  } catch {
    return true;
  }
}

function readTab(): Tab {
  try {
    return localStorage.getItem(TAB_KEY) === 'library' ? 'library' : 'transitions';
  } catch {
    return 'transitions';
  }
}

const NO_CUTS = 'Add another clip from the Library to make a cut, then add a transition there.';
const NO_TARGET = 'Click + between two clips to choose a cut, or drag a preset onto a cut.';

/** Lucide icon size in the timeline bar. */
const ICON = 16;
const SMALL_ICON = 14;

const SPLIT_REASONS:Record<Exclude<SplitResult, { ok: true }>['reason'], string> = {
  'on-cut': 'The playhead is on a cut; move it inside a clip to split',
  'in-transition': 'The playhead is inside a transition',
  outside: 'Move the playhead inside a clip to split',
};

/**
 * Owns the undoable document and the interaction state. Remounted (via key)
 * when the clip manifest reloads, which resets history. Renders
 * the sidebar (Library / Transitions) and the timeline pane into the shell's slots.
 */
export function Editor({ baseDoc, sources, feeder, thumbs, controller, ready, reducedMotion, announce, sidebarEl, timelineEl, previewEl }: Props) {
  const [history, setHistory] = useState<History<Doc>>(() => createHistory(baseDoc));
  const doc = history.present;

  const [playhead, setPlayhead] = useState<Frames>(0);
  const [playing, setPlaying] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  const [targetCutKey, setTargetCutKey] = useState<string | null>(null);
  const [tab, setTabState] = useState<Tab>(readTab);
  const [pickerActive, setPickerActive] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewOnHover, setPreviewOnHoverState] = useState(readPreviewOnHover);
  const [preview, setPreview] = useState({ active: false, playing: false });
  const [looping, setLooping] = useState(false);
  /** The popover's Fine-tune section; stays open across selections. */
  const [fineTuneOpen, setFineTuneOpen] = useState(false);
  const [zoom, setZoom] = useState<number | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [libDrag, setLibDrag] = useState<{ sourceId: string; x: number; y: number; index: number | null } | null>(null);
  const [presetDrag, setPresetDrag] = useState<PresetDrag | null>(null);
  const [, setFocusTick] = useState(0);
  /** In/out marks per Library clip. Not part of undo: they describe the Library, not the edit. */
  const [marks, setMarks] = useState<Readonly<Record<string, Marks>>>({});
  /** The Library clip Insert adds: the one last played in the preview. */
  const [insertSourceId, setInsertSourceId] = useState<string | null>(null);

  const pickerListRef = useRef<HTMLDivElement>(null);
  const editHeadingRef = useRef<HTMLHeadingElement>(null);
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ library: null, transitions: null });
  const [cutEls] = useState(() => new Map<string, HTMLButtonElement>());
  const [transitionEls] = useState(() => new Map<string, HTMLButtonElement>());
  const timelineApi = useRef<TimelineApi>(null);
  const pendingFocus = useRef<FocusTarget | null>(null);
  const libDragRef = useRef(libDrag);
  libDragRef.current = libDrag;
  const presetDragRef = useRef(presetDrag);
  presetDragRef.current = presetDrag;
  const sliderGesture = useRef(false);
  const pickerId = useId();
  const tabsId = useId();

  // --- derived -----------------------------------------------------------------

  const cutList = useMemo(() => cuts(doc), [doc]);
  const selectedTransition = selection?.kind === 'transition' ? transitionById(doc, selection.id) : null;
  // Only an explicit choice targets a cut: a selected transition, or a cut picked with +.
  // There is no fallback, so with nothing chosen the presets can't be applied by click.
  const targetCut = selectedTransition ? cutByKey(doc, transitionCutKey(selectedTransition)) : cutByKey(doc, targetCutKey);
  const targetTransition = targetCut ? transitionAt(doc, targetCut.key) : null;
  const limits = useMemo(() => (targetCut ? getLimits(doc, targetCut) : null), [doc, targetCut]);
  const len = timelineLength(doc);
  const ppf = zoom ?? fitScale(len, viewportWidth);
  const sourceIndex = useMemo(() => new Map(sources.map((s, i) => [s.id, i] as const)), [sources]);
  const sourceTone = useCallback((id: string) => sourceIndex.get(id) ?? 0, [sourceIndex]);
  const sourceLabel = useCallback((id: string) => sources.find((s) => s.id === id)?.label ?? id, [sources]);
  // The Library clip shown in the preview, as a string so per-frame updates don't re-render the editor.
  const shownKey = useSyncExternalStore(controller.subscribeSource, () => {
    const s = controller.getSourceState();
    return s ? `${s.playing ? 1 : 0}${s.sourceId}` : '';
  });
  const shown: ShownSource | null = useMemo(
    () => (shownKey ? { sourceId: shownKey.slice(1), playing: shownKey[0] === '1' } : null),
    [shownKey],
  );
  const splitCheck = useMemo(() => splitClip(doc, playhead), [doc, playhead]);

  const setTab = (t: Tab) => {
    setTabState(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      // Not persisted; fine.
    }
  };

  // --- controller wiring -------------------------------------------------------

  useLayoutEffect(() => {
    controller.setCallbacks({
      onPlayhead: setPlayhead,
      onPlayingChange: setPlaying,
      onPreviewChange: (s) => {
        setPreview(s);
        if (!s.active) {
          setPreviewId(null);
          setLooping(false);
        }
      },
    });
    return () => controller.setCallbacks(null);
  }, [controller]);

  useLayoutEffect(() => controller.setDoc(doc), [controller, doc]);
  useLayoutEffect(() => controller.setPlayhead(playhead), [controller, playhead]);
  useEffect(() => () => controller.endPreview(), [controller]);

  // Keep the playhead inside the timeline as it shrinks.
  useEffect(() => {
    if (playhead > len - 1) setPlayhead(Math.max(0, len - 1));
  }, [len, playhead]);

  // --- history -----------------------------------------------------------------

  const commitDoc = useCallback((next: Doc, label: string) => {
    setHistory((h) => commit(h, next, label, docEquals));
  }, []);

  const gesture = useMemo(
    () => ({
      begin: () => setHistory((h) => beginGesture(h)),
      update: (d: Doc) => setHistory((h) => updateGesture(h, d)),
      end: (label: string) => setHistory((h) => endGesture(h, label, docEquals)),
      cancel: () => setHistory((h) => cancelGesture(h)),
    }),
    [],
  );

  // --- derived behaviour on document changes --------------------------------

  // Drop a selection whose clip or transition no longer exists (undo, delete, move).
  useEffect(() => {
    if (!selection) return;
    const exists = selection.kind === 'clip' ? clipIndexById(doc, selection.id) >= 0 : !!transitionById(doc, selection.id);
    if (!exists) setSelection(null);
  }, [doc, selection]);

  // Forget a target cut that no longer exists, so it can't come back on redo unasked.
  useEffect(() => {
    if (targetCutKey && !cutByKey(doc, targetCutKey)) setTargetCutKey(null);
  }, [doc, targetCutKey]);

  // Keep the selected-transition loop in sync with Feel, Fine-tune and duration edits.
  // The transition object only changes identity when one of those does.
  useEffect(() => {
    if (!looping) return;
    if (!selectedTransition) {
      controller.endPreview();
      return;
    }
    const { id: _id, fromId: _from, toId: _to, ...look } = selectedTransition;
    controller.preview({ cutKey: transitionCutKey(selectedTransition), ...look }, { autoplay: true, once: reducedMotion });
  }, [controller, looping, selectedTransition, reducedMotion]);

  // A picker preview belongs to its cut; switching cuts ends it.
  const targetKey = targetCut?.key ?? null;
  const loopingRef = useRef(looping);
  loopingRef.current = looping;
  useEffect(() => {
    if (loopingRef.current) return;
    controller.endPreview();
    setPreviewId(null);
  }, [controller, targetKey]);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    const el =
      target.kind === 'picker'
        ? pickerListRef.current?.querySelector<HTMLElement>('[tabindex="0"]')
        : target.kind === 'cut'
          ? cutEls.get(target.key)
          : target.kind === 'transition'
            ? transitionEls.get(target.id)
            : editHeadingRef.current;
    el?.focus({ preventScroll: true });
  });

  const requestFocus = (target: FocusTarget) => {
    pendingFocus.current = target;
    setFocusTick((n) => n + 1);
  };

  // --- selection & sidebar -------------------------------------------------------

  const select = useCallback(
    (sel: Selection) => {
      setSelection(sel);
      if (sel?.kind === 'transition') {
        const t = transitionById(doc, sel.id);
        setTargetCutKey(t ? transitionCutKey(t) : null);
        setTab('transitions');
      } else {
        // Selecting a clip or clicking empty space leaves the cut.
        setTargetCutKey(null);
      }
    },
    [doc],
  );

  /** + at a cut: target it and move into the picker. */
  const chooseAtCut = (key: string) => {
    if (!ready) return;
    controller.pause();
    setTargetCutKey(key);
    setSelection(null);
    setTab('transitions');
    requestFocus({ kind: 'picker' });
    const cut = cutByKey(doc, key);
    if (cut) {
      const l = getLimits(doc, cut);
      if (!l.canTransition) announce(describeNoHandles(cut, l));
    }
  };

  /** Esc from the picker: back to the transition or cut it acts on. */
  const leavePicker = () => {
    controller.endPreview();
    setPreviewId(null);
    if (targetTransition) {
      requestFocus({ kind: 'transition', id: targetTransition.id });
    } else if (targetCut) {
      requestFocus({ kind: 'cut', key: targetCut.key });
    }
  };

  // --- transition actions ------------------------------------------------------

  /**
   * What applying `presetId` at `cut` would look like. An existing transition keeps its duration,
   * Feel and Fine-tuned curve (and its Fine-tuned intensity when the preset stays the same).
   */
  const candidateAt = (cut: Cut, presetId: string): PreviewCandidate | null => {
    const l = getLimits(doc, cut);
    if (!l.canTransition) return null;
    const t = transitionAt(doc, cut.key);
    if (t) {
      return {
        cutKey: cut.key,
        presetId,
        duration: t.duration,
        feel: t.feel,
        ...(t.easing && { easing: t.easing }),
        ...(t.intensity !== undefined && t.presetId === presetId && { intensity: t.intensity }),
      };
    }
    // A new transition may trim the clips to make room: preview the timeline as it would be.
    const r = applyTransition(doc, cut.key, presetId, TRANSITION_DEFAULTS);
    if (!r.ok) return null;
    const { feel, duration } = r.transition;
    return { cutKey: cut.key, presetId, duration, feel, ...(r.trimmed !== NO_ROOM && { doc: r.doc }) };
  };

  /** What applying a preset at `cut` would trim to make room (nothing when replacing). */
  const roomAt = (cut: Cut): Room => {
    if (transitionAt(doc, cut.key)) return NO_ROOM;
    const l = getLimits(doc, cut);
    return l.canTransition ? roomFor(cut, clampDuration(TRANSITION_DEFAULTS.duration, l).duration) : NO_ROOM;
  };

  const onPreview = (id: string) => {
    if (!previewOnHover) return;
    const c = targetCut ? candidateAt(targetCut, id) : null;
    if (!c) return;
    setPreviewId(id);
    controller.preview(c, { autoplay: !reducedMotion, once: false });
  };

  const setPreviewOnHover = (on: boolean) => {
    setPreviewOnHoverState(on);
    try {
      localStorage.setItem(HOVER_PREVIEW_KEY, on ? 'on' : 'off');
    } catch {
      // Not persisted; fine.
    }
    // Turning it off stops a gallery preview that's running now.
    if (!on && previewId && !presetDragRef.current) {
      controller.endPreview();
      setPreviewId(null);
    }
  };

  const onLeavePreview = () => {
    // A preset drag owns the preview until it drops.
    if (presetDragRef.current) return;
    controller.endPreview();
    setPreviewId(null);
  };

  /** Click / Enter in the picker: acts on the chosen cut only. */
  const onApply = (id: string) => {
    if (!targetCut) {
      announce(NO_TARGET);
      return;
    }
    applyAt(targetCut, id);
  };

  const applyAt = (target: Cut, id: string) => {
    const preset = getPreset(id);
    const r = applyTransition(doc, target.key, id, { feel: TRANSITION_DEFAULTS.feel, duration: TRANSITION_DEFAULTS.duration });
    if (!r.ok) {
      if (r.limits) announce(describeNoHandles(target, r.limits));
      return;
    }
    if (r.doc !== doc) commitDoc(r.doc, r.replaced ? `Change to ${preset.name}` : `Apply ${preset.name}`);
    controller.endPreview();
    setPreviewId(null);
    setTargetCutKey(target.key);
    setSelection({ kind: 'transition', id: r.transition.id });
    setTab('transitions');
    requestFocus({ kind: 'edit' });
    const cut = cutByKey(r.doc, target.key)!;
    const capped = r.clamped === 'max' ? ` ${describeLimit(cut, getLimits(r.doc, cut))}.` : '';
    const trimmed = r.trimmed !== NO_ROOM ? ` ${describeTrim(cut, r.trimmed)}` : '';
    if (r.doc === doc) announce(`${preset.name} selected`);
    else if (r.replaced) announce(`Changed to ${preset.name}: ${formatDuration(r.transition.duration)}, Feel kept.${capped}`);
    else announce(`${preset.name} applied: ${formatDuration(r.transition.duration)}, centred on the cut.${trimmed}${capped}`);
  };

  const removeTransitionAt = (cutKey: string) => {
    const t = transitionAt(doc, cutKey);
    if (!t) return;
    const name = getPreset(t.presetId).name;
    controller.endPreview();
    commitDoc(removeTransition(doc, cutKey), `Remove ${name}`);
    setSelection(null);
    // Stay on the cut, so another preset can go straight back on.
    setTargetCutKey(cutKey);
    requestFocus({ kind: 'cut', key: cutKey });
    announce(`${name} removed`);
  };

  /** A slider drag in the popover is one undo step, labelled `label`. */
  const onSliderPointerDown = (label: string) => {
    if (sliderGesture.current) return;
    sliderGesture.current = true;
    gesture.begin();
    const end = () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      sliderGesture.current = false;
      gesture.end(label);
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };

  /** Apply a Feel / Fine-tune edit to the selected transition, inside a slider drag or as its own step. */
  const editLook = (edit: (doc: Doc, cutKey: string) => Doc, label: string) => {
    const t = selectedTransition;
    if (!t) return;
    const next = edit(doc, transitionCutKey(t));
    if (next === doc) return;
    if (sliderGesture.current) gesture.update(next);
    else commitDoc(next, label);
  };

  const onFeelInput = (value: number) => editLook((d, k) => setFeel(d, k, value), 'Change feel');
  const onIntensityInput = (value: number) => editLook((d, k) => setIntensity(d, k, value), 'Change intensity');
  const onEasingPick = (bezier: Bezier) => editLook((d, k) => setEasing(d, k, bezier), 'Change easing');
  const onResetTuning = () => editLook(resetTuning, 'Reset to Feel');

  const onStepDuration = (cutKey: string, requested: Frames) => {
    const r = setDuration(doc, cutKey, requested);
    if (r.doc !== doc) commitDoc(r.doc, 'Change duration');
    const cut = r.trimmed !== NO_ROOM ? cutByKey(r.doc, cutKey) : null;
    if (cut) announce(describeTrim(cut, r.trimmed));
    return r;
  };

  // --- clip actions ------------------------------------------------------------

  const labelOf = (id: string) => doc.clips.find((c) => c.id === id)?.label ?? 'clip';

  const insertSource = (sourceId: string, index: number) => {
    const source = sources.find((s) => s.id === sourceId);
    if (!source) return;
    controller.endPreview();
    const r = insertClipRange(doc, source, index, markedRange(source.frames, marks[source.id]));
    commitDoc(r.doc, `Add ${source.label}`);
    setSelection({ kind: 'clip', id: r.clip.id });
    setTargetCutKey(null);
    const at = cuts(r.doc).find((c) => c.to.id === r.clip.id)?.frame ?? 0;
    announce(`${source.label} added at ${formatTimecode(at)}, ${formatDuration(r.clip.sourceOut - r.clip.sourceIn)}`);
  };

  const onMoveClip = (id: string, toIndex: number) => {
    const next = moveClip(doc, id, toIndex);
    if (next === doc) return;
    commitDoc(next, `Move ${labelOf(id)}`);
    const dropped = doc.transitions.length - next.transitions.length;
    announce(`${labelOf(id)} moved${dropped > 0 ? `; ${dropped} transition${dropped === 1 ? '' : 's'} removed with its cuts` : ''}`);
  };

  const onNudgeClip = (id: string, delta: -1 | 1) => {
    const i = clipIndexById(doc, id);
    if (i < 0) return;
    onMoveClip(id, delta < 0 ? i - 1 : i + 2);
  };

  const onTrimStep = (id: string, edge: TrimEdge, requested: Frames) => {
    const r = trimClip(doc, id, edge, requested);
    if (r.doc !== doc) commitDoc(r.doc, `Trim ${labelOf(id)}`);
    return r;
  };

  const doSplit = () => {
    if (!ready) return;
    const r = splitClip(doc, playhead);
    if (!r.ok) {
      announce(SPLIT_REASONS[r.reason]);
      return;
    }
    controller.pause();
    controller.endPreview();
    commitDoc(r.doc, `Split ${r.left.label}`);
    setSelection(null);
    setTargetCutKey(null);
    announce(`${r.left.label} split at ${formatTimecode(playhead)}`);
  };

  const deleteSelected = () => {
    if (!selection) return;
    if (selection.kind === 'transition') {
      const t = transitionById(doc, selection.id);
      if (t) removeTransitionAt(transitionCutKey(t));
      return;
    }
    const label = labelOf(selection.id);
    const next = deleteClip(doc, selection.id);
    if (next === doc) return;
    controller.endPreview();
    commitDoc(next, `Delete ${label}`);
    setSelection(null);
    setTargetCutKey(null);
    announce(next.clips.length === 0 ? `${label} deleted. The timeline is empty` : `${label} deleted`);
  };

  // --- library drag ----------------------------------------------------------

  const onLibDragStart = (sourceId: string, x: number, y: number) => {
    controller.pause();
    controller.endPreview();
    setLibDrag({ sourceId, x, y, index: timelineApi.current?.hit(x, y) ?? null });
  };
  const onLibDragMove = (x: number, y: number) => {
    if (!libDragRef.current) return;
    setLibDrag((d) => (d ? { ...d, x, y, index: timelineApi.current?.hit(x, y) ?? null } : d));
  };
  const onLibDragEnd = (commitDrop: boolean) => {
    const d = libDragRef.current;
    setLibDrag(null);
    if (commitDrop && d && d.index !== null) insertSource(d.sourceId, d.index);
  };

  // --- preset drag (drop a preset on any cut) ---------------------------------

  /** Preview the dragged preset at the cut under the pointer; stop when it leaves. */
  const previewDragAt = (presetId: string, cutKey: string | null) => {
    const cut = cutByKey(doc, cutKey);
    const c = cut ? candidateAt(cut, presetId) : null;
    if (c) {
      setPreviewId(presetId);
      controller.preview(c, { autoplay: !reducedMotion, once: false });
    } else {
      controller.endPreview();
      setPreviewId(null);
    }
  };

  const onPresetDragStart = (presetId: string, x: number, y: number) => {
    controller.pause();
    const cutKey = timelineApi.current?.hitCut(x, y) ?? null;
    const d: PresetDrag = { presetId, x, y, cutKey };
    presetDragRef.current = d;
    setPresetDrag(d);
    previewDragAt(presetId, cutKey);
  };
  const onPresetDragMove = (x: number, y: number) => {
    const d = presetDragRef.current;
    if (!d) return;
    const cutKey = timelineApi.current?.hitCut(x, y) ?? null;
    if (cutKey !== d.cutKey) previewDragAt(d.presetId, cutKey);
    const next: PresetDrag = { ...d, x, y, cutKey };
    presetDragRef.current = next;
    setPresetDrag(next);
  };
  const onPresetDragEnd = (commitDrop: boolean) => {
    const d = presetDragRef.current;
    presetDragRef.current = null;
    setPresetDrag(null);
    if (!d) return;
    const cut = commitDrop ? cutByKey(doc, d.cutKey) : null;
    if (cut) {
      applyAt(cut, d.presetId);
      return;
    }
    controller.endPreview();
    setPreviewId(null);
    if (commitDrop) announce('Drop a preset on a cut between two clips');
  };

  // --- history / transport ------------------------------------------------------

  const doUndo = () => {
    if (!canUndo(history)) return;
    const label = undoLabel(history);
    setHistory((h) => undo(h));
    announce(`Undo: ${label}`);
  };

  const doRedo = () => {
    if (!canRedo(history)) return;
    const label = redoLabel(history);
    setHistory((h) => redo(h));
    announce(`Redo: ${label}`);
  };

  const togglePlay = () => {
    if (controller.isShowingSource) controller.toggleSourcePlayback();
    else if (controller.isPreviewing) controller.togglePreviewPlayback();
    else controller.togglePlay();
  };

  // --- library clip in the preview ----------------------------------------------

  const playSourceFromStart = (sourceId: string) => {
    const s = sources.find((x) => x.id === sourceId);
    if (!s || !ready) return;
    controller.showSource(s.id, s.label, s.frames);
    setInsertSourceId(s.id);
    announce(`Playing ${s.label} in the preview. Escape returns to the timeline`);
  };
  const toggleSource = (sourceId: string) => {
    if (controller.getSourceState()?.sourceId === sourceId) controller.toggleSourcePlayback();
    else playSourceFromStart(sourceId);
  };

  const setShownMarks = (update: (m: Marks) => Marks) => {
    const s = controller.getSourceState();
    if (!s) return;
    setMarks((all) => ({ ...all, [s.sourceId]: update(all[s.sourceId] ?? NO_MARKS) }));
  };
  const markShownIn = (frame: Frames) => setShownMarks((m) => markIn(m, frame));
  const markShownOut = (frame: Frames) => setShownMarks((m) => markOut(m, frame));
  const clearShownMarks = () => setShownMarks(() => NO_MARKS);

  const insertSourceClip = sources.find((s) => s.id === insertSourceId) ?? null;
  const insertCheck = useMemo(
    () =>
      insertSourceClip
        ? insertAtFrame(doc, insertSourceClip, playhead, markedRange(insertSourceClip.frames, marks[insertSourceClip.id]))
        : null,
    [doc, insertSourceClip, playhead, marks],
  );
  const insertReason = !insertSourceClip
    ? 'Play a Library clip first'
    : insertCheck && !insertCheck.ok
      ? 'The playhead is inside a transition'
      : null;

  /** Insert the last played Library clip (its marked part) at the playhead; the playhead moves to its end. */
  const doInsert = () => {
    if (!ready) return;
    if (!insertSourceClip || !insertCheck) {
      announce('Play a Library clip first, then insert it');
      return;
    }
    if (!insertCheck.ok) {
      announce('The playhead is inside a transition; move it out to insert');
      return;
    }
    const { doc: next, clip, at } = insertCheck;
    controller.pause();
    controller.endPreview();
    controller.endSource();
    commitDoc(next, `Insert ${insertSourceClip.label}`);
    setSelection({ kind: 'clip', id: clip.id });
    setTargetCutKey(null);
    const length = clip.sourceOut - clip.sourceIn;
    setPlayhead(at + length);
    announce(`${insertSourceClip.label} inserted at ${formatTimecode(at)}, ${formatDuration(length)}`);
  };

  // Working in the timeline brings the preview back to it.
  const showingSource = shown !== null;
  useEffect(() => {
    if (!showingSource) return;
    const onDown = (e: globalThis.PointerEvent) => {
      if (e.target instanceof Node && timelineEl.contains(e.target)) controller.endSource();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [showingSource, timelineEl, controller]);

  const onScrubStart = () => {
    controller.pause();
    controller.endPreview();
  };

  // --- global shortcuts --------------------------------------------------------

  const hasTarget = targetCutKey !== null;
  const shortcuts = { doUndo, doRedo, togglePlay, deleteSelected, leavePicker, select, doSplit, doInsert, markShownIn, markShownOut, onPresetDragEnd, selection, hasTarget, looping };
  const latest = useRef(shortcuts);
  useLayoutEffect(() => {
    latest.current = shortcuts;
  });

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const s = latest.current;
      const el = e.target as HTMLElement | null;
      // An open modal (the shortcuts list) owns the keyboard.
      if (el?.closest('dialog')) return;
      const tag = el?.tagName;
      const textEntry = isTextEntry(el);
      const mod = isMac ? e.metaKey : e.ctrlKey;

      if (mod && e.key.toLowerCase() === 'z' && !textEntry) {
        e.preventDefault();
        if (e.shiftKey) s.doRedo();
        else s.doUndo();
        return;
      }
      if (!isMac && e.ctrlKey && e.key.toLowerCase() === 'y' && !textEntry) {
        e.preventDefault();
        s.doRedo();
        return;
      }
      if (textEntry || tag === 'SELECT' || e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === ' ') {
        e.preventDefault();
        if (!e.repeat) s.togglePlay();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && s.selection) {
        e.preventDefault();
        s.deleteSelected();
      } else if (e.key.toLowerCase() === 's' && !e.repeat) {
        e.preventDefault();
        s.doSplit();
      } else if (e.key.toLowerCase() === 'w' && !e.repeat) {
        e.preventDefault();
        s.doInsert();
      } else if ((e.key.toLowerCase() === 'i' || e.key.toLowerCase() === 'o') && controller.isShowingSource) {
        e.preventDefault();
        const frame = controller.getSourceState()?.frame ?? 0;
        if (e.key.toLowerCase() === 'i') s.markShownIn(frame);
        else s.markShownOut(frame);
      } else if (e.key === 'Escape') {
        if (libDragRef.current) setLibDrag(null);
        else if (presetDragRef.current) s.onPresetDragEnd(false);
        else if (controller.isShowingSource) controller.endSource();
        else if (s.looping) controller.endPreview();
        else if (s.selection || s.hasTarget) s.select(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [controller]);

  // A press outside the transition popover closes it by deselecting the transition. The sidebar
  // (presets swap it), the timeline bar (play, zoom, undo) and other transitions don't count.
  const popoverOpen = selectedTransition !== null;
  useEffect(() => {
    if (!popoverOpen) return;
    const onDown = (e: globalThis.PointerEvent) => {
      const el = e.target as Element | null;
      if (!el || sidebarEl.contains(el)) return;
      if (el.closest('.tpopover, .transition-object, .timeline-bar, dialog')) return;
      latest.current.select(null);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [popoverOpen, sidebarEl]);

  // --- render ----------------------------------------------------------------

  const mod = modKey;
  // A cut picked with + and still waiting for a preset: mark where the transition will land,
  // if one fits there (the previewed preset, else the first one).
  const pendingCandidate =
    tab === 'transitions' && targetCut && !targetTransition
      ? candidateAt(targetCut, previewId ?? PRESETS[0]!.id)
      : null;
  const pendingCutKey = pendingCandidate?.cutKey ?? null;

  const cutNumber = targetCut ? targetCut.index + 1 : 0;
  const cutLabel = targetCut ? `Cut ${cutNumber} · ${targetCut.from.label} → ${targetCut.to.label}` : null;
  const selectedCut = selectedTransition ? cutByKey(doc, transitionCutKey(selectedTransition)) : null;
  const disabledReason =
    cutList.length === 0
      ? NO_CUTS
      : !targetCut
        ? NO_TARGET
        : limits && !limits.canTransition
          ? describeNoHandles(targetCut, limits)
          : null;
  // Nothing chosen yet is a prompt, not a problem.
  const noticeTone = cutList.length > 0 && !targetCut ? 'info' : 'warn';
  const canDragPresets = ready && cutList.length > 0;

  const dragCut = presetDrag ? cutByKey(doc, presetDrag.cutKey) : null;
  const dragLimits = dragCut ? getLimits(doc, dragCut) : null;
  const dragValid = !!dragLimits?.canTransition;
  const dragRoom = dragCut && dragValid ? roomAt(dragCut) : NO_ROOM;
  const dragNote = !dragCut
    ? 'Drop on a cut'
    : !dragValid
      ? `Clips too short at Cut ${dragCut.index + 1}`
      : `${transitionAt(doc, dragCut.key) ? 'Replace at' : 'Apply to'} Cut ${dragCut.index + 1}` +
        (dragRoom !== NO_ROOM ? ` · trims ${describeRoom(dragCut, dragRoom)}` : '');
  // Frames that applying a preset would trim off the clips, shaded on the timeline.
  const trimPreview =
    dragCut && dragRoom !== NO_ROOM
      ? { cutKey: dragCut.key, room: dragRoom }
      : !presetDrag && pendingCandidate?.doc && targetCut
        ? { cutKey: targetCut.key, room: roomAt(targetCut) }
        : null;

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const next: Tab = tab === 'library' ? 'transitions' : 'library';
    setTab(next);
    tabRefs.current[next]?.focus();
  };

  const tabButton = (id: Tab, label: string, glyph: ReactNode) => (
    <button
      ref={(el) => {
        tabRefs.current[id] = el;
      }}
      type="button"
      role="tab"
      id={`${tabsId}-${id}`}
      className={`rail-item${tab === id ? ' active' : ''}`}
      aria-selected={tab === id}
      tabIndex={tab === id ? 0 : -1}
      onClick={() => setTab(id)}
      onKeyDown={onTabKey}
    >
      <span className="rail-icon" aria-hidden="true">
        {glyph}
      </span>
      <span className="rail-label">{label}</span>
    </button>
  );

  const sidebar = (
    <>
      <div className="rail" role="tablist" aria-orientation="vertical" aria-label="Sidebar">
        {tabButton('library', 'Library', <LibraryGlyph />)}
        {tabButton('transitions', 'Transitions', <TransitionsGlyph />)}
      </div>
      <div className="sidebar-panel">
        {tab === 'library' ? (
          <LibraryPanel
            sources={sources}
            feeder={feeder}
            thumbs={thumbs}
            ready={ready}
            sourceTone={sourceTone}
            shown={shown}
            marks={marks}
            onTogglePlay={toggleSource}
            onPlayFromStart={playSourceFromStart}
            onDragStart={onLibDragStart}
            onDragMove={onLibDragMove}
            onDragEnd={onLibDragEnd}
          />
        ) : (
          <TransitionsPanel
            canDragPresets={canDragPresets}
            cutLabel={cutLabel}
          >
            <Gallery
                key={targetCut?.key ?? 'none'}
                presets={PRESETS}
                appliedId={targetTransition?.presetId ?? null}
                previewId={previewId}
                disabledReason={disabledReason}
                noticeTone={noticeTone}
                draggable={canDragPresets}
                draggingId={presetDrag?.presetId ?? null}
                onDragStart={onPresetDragStart}
                onDragMove={onPresetDragMove}
                onDragEnd={onPresetDragEnd}
                listRef={pickerListRef}
                listId={pickerId}
                previewOnHover={previewOnHover}
                onPreviewOnHoverChange={setPreviewOnHover}
                onPreview={onPreview}
                onLeave={onLeavePreview}
                onApply={onApply}
                onEscape={leavePicker}
                onActiveChange={setPickerActive}
              />
          </TransitionsPanel>
        )}
      </div>
    </>
  );

  const zoomSlider = zoomToSlider(ppf);
  const splitReason = splitCheck.ok ? null : SPLIT_REASONS[splitCheck.reason];

  const timeline = (
    <>
      <div className="timeline-bar">
        <div className="bar-left">
          <span className="timecode">
            {formatClock(playhead)} <span className="timecode-total">/ {formatClock(len)}</span>
          </span>
          <span className="bar-divider" aria-hidden="true" />
          <button
            type="button"
            className="btn-icon"
            onClick={doUndo}
            disabled={!canUndo(history)}
            aria-label={canUndo(history) ? `Undo ${undoLabel(history)}` : 'Undo'}
            data-tip={canUndo(history) ? `Undo ${undoLabel(history)}` : 'Nothing to undo'}
            data-keys={canUndo(history) ? `${mod} Z` : undefined}
            aria-keyshortcuts={isMac ? 'Meta+Z' : 'Control+Z'}
          >
            <Undo2 size={ICON} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn-icon"
            onClick={doRedo}
            disabled={!canRedo(history)}
            aria-label={canRedo(history) ? `Redo ${redoLabel(history)}` : 'Redo'}
            data-tip={canRedo(history) ? `Redo ${redoLabel(history)}` : 'Nothing to redo'}
            data-keys={canRedo(history) ? `⇧ ${mod} Z` : undefined}
            aria-keyshortcuts={isMac ? 'Shift+Meta+Z' : 'Shift+Control+Z'}
          >
            <Redo2 size={ICON} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn-icon"
            onClick={doSplit}
            disabled={!ready || !splitCheck.ok}
            aria-label={splitReason ? `Split at playhead (${splitReason})` : 'Split at playhead'}
            data-tip={splitReason ?? 'Split'}
            data-keys={splitReason ? undefined : 'S'}
            aria-keyshortcuts="S"
          >
            <SquareSplitHorizontal size={ICON} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn-icon"
            onClick={doInsert}
            disabled={!ready || insertReason !== null}
            aria-label={
              insertSourceClip
                ? `Insert ${insertSourceClip.label} at playhead${insertReason ? ` (${insertReason})` : ''}`
                : `Insert at playhead (${insertReason})`
            }
            data-tip={insertReason ?? `Insert ${insertSourceClip?.label ?? ''} at playhead`}
            data-keys={insertReason ? undefined : 'W'}
            aria-keyshortcuts="W"
          >
            <BetweenVerticalStart size={ICON} aria-hidden="true" />
          </button>
        </div>
        <button
          type="button"
          className="btn-play"
          onClick={() => controller.togglePlay()}
          aria-label={playing ? 'Pause' : 'Play'}
          aria-keyshortcuts="Space"
          disabled={!ready || len === 0}
        >
          <span aria-hidden="true">{playing ? <Pause size={SMALL_ICON}/> : <Play size={SMALL_ICON}/>}</span>
        </button>
        <div className="bar-right">
          {reducedMotion && (
            <>
              <span className="badge">Reduced motion: previews show a still frame</span>
              <span className="bar-divider" aria-hidden="true" />
            </>
          )}
          <div className="zoom" role="group" aria-label="Timeline zoom">
            <button type="button" className="btn-icon" onClick={() => setZoom(clampZoom(ppf / 1.25))} aria-label="Zoom out" data-tip="Zoom out">
              <Minus size={SMALL_ICON} aria-hidden="true" />
            </button>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={zoomSlider}
              style={{ '--t': zoomSlider / 100 } as CSSProperties}
              aria-label="Zoom"
              aria-valuetext={`${ppf.toFixed(2)} pixels per frame${zoom === null ? ', fit to width' : ''}`}
              onChange={(e) => setZoom(sliderToZoom(Number(e.currentTarget.value)))}
            />
            <button type="button" className="btn-icon" onClick={() => setZoom(clampZoom(ppf * 1.25))} aria-label="Zoom in" data-tip="Zoom in">
              <Plus size={SMALL_ICON} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="btn-icon zoom-fit"
              onClick={() => setZoom(fitScale(len, viewportWidth))}
              aria-label="Zoom to fit"
              data-tip="Zoom to fit"
            >
              <Scan size={ICON} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      <Timeline
        doc={doc}
        playhead={playhead}
        ready={ready}
        ppf={ppf}
        selection={selection}
        targetCutKey={targetCut?.key ?? null}
        pendingCutKey={pendingCutKey}
        pickerActive={tab === 'transitions' && !selectedTransition && (pickerActive || preview.active)}
        pickerId={pickerId}
        dropIndex={libDrag?.index ?? null}
        dropCutKey={dragCut?.key ?? null}
        dropCutValid={dragValid}
        trimPreview={trimPreview}
        cutEls={cutEls}
        transitionEls={transitionEls}
        apiRef={timelineApi}
        sourceTone={sourceTone}
        onViewportWidth={setViewportWidth}
        onScrubStart={onScrubStart}
        onScrub={setPlayhead}
        onSelect={select}
        onChooseAtCut={chooseAtCut}
        gesture={gesture}
        onStepDuration={onStepDuration}
        onMoveClip={onMoveClip}
        onNudgeClip={onNudgeClip}
        onTrimStep={onTrimStep}
        announce={announce}
      />
    </>
  );

  return (
    <>
      {createPortal(sidebar, sidebarEl)}
      {shown &&
        createPortal(
          <SourceControls
            controller={controller}
            marks={marks[shown.sourceId]}
            onMarkIn={markShownIn}
            onMarkOut={markShownOut}
            onClearMarks={clearShownMarks}
          />,
          previewEl,
        )}
      {createPortal(<ThumbsContext.Provider value={thumbs}>{timeline}</ThumbsContext.Provider>, timelineEl)}
      {selectedTransition && selectedCut && (
        <TransitionPopover
          transition={selectedTransition}
          anchor={() => transitionEls.get(selectedTransition.id) ?? null}
          looping={looping}
          headingRef={editHeadingRef}
          fineTuneOpen={fineTuneOpen}
          onFineTuneToggle={() => setFineTuneOpen((o) => !o)}
          onSliderPointerDown={onSliderPointerDown}
          onFeelInput={onFeelInput}
          onIntensityInput={onIntensityInput}
          onEasingPick={onEasingPick}
          onResetTuning={onResetTuning}
          onRemove={() => removeTransitionAt(selectedCut.key)}
          onToggleLoop={() => (looping ? controller.endPreview() : setLooping(true))}
        />
      )}
      {libDrag &&
        createPortal(
          <div
            className={`drag-ghost tone-${sourceTone(libDrag.sourceId) % 4}${libDrag.index === null ? ' outside' : ''}`}
            style={{ left: libDrag.x, top: libDrag.y }}
            aria-hidden="true"
          >
            {sourceLabel(libDrag.sourceId)}
          </div>,
          document.body,
        )}
      {presetDrag &&
        createPortal(
          <div
            className={`drag-ghost preset-ghost${dragCut ? (dragValid ? '' : ' invalid') : ' outside'}`}
            style={{ left: presetDrag.x, top: presetDrag.y }}
            aria-hidden="true"
          >
            <span className="preset-ghost-name">{getPreset(presetDrag.presetId).name}</span>
            <span className="preset-ghost-note">{dragNote}</span>
          </div>,
          document.body,
        )}
    </>
  );
}

/** Stacked cards: the rail glyph for the Library tab. */
function LibraryGlyph() {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" focusable="false">
      <rect x="3" y="6.5" width="14" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.5 4h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M8.5 9.5v4l3.5-2z" fill="currentColor" />
    </svg>
  );
}

/** Two overlapping frames: the rail glyph for the Transitions tab. */
function TransitionsGlyph() {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" focusable="false">
      <rect x="2.5" y="4.5" width="9" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="8.5" y="4.5" width="9" height="11" rx="2" fill="currentColor" fillOpacity="0.18" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

