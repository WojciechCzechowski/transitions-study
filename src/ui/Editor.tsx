import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { LIBRARY_INSERT } from '../config/study.config';
import { getPreset, PRESETS, TRANSITION_DEFAULTS } from '../config/transitions.config';
import type { FrameStore } from '../media/FrameStore';
import { feelToParams } from '../model/feel';
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
import { sidebarView } from '../model/layout';
import { describeLimit, describeNoHandles } from '../model/messages';
import {
  applyTransition,
  deleteClip,
  insertClip,
  moveClip,
  removeTransition,
  setDuration,
  setFeel,
  splitClip,
  trimClip,
  type SplitResult,
  type TrimEdge,
} from '../model/ops';
import {
  clipIndexById,
  cutByKey,
  cuts,
  docEquals,
  getLimits,
  timelineLength,
  transitionAt,
  transitionById,
  transitionCutKey,
  type Cut,
  type Doc,
  type FrameRef,
  type Source,
} from '../model/timeline';
import { clampZoom, fitScale, insertionIndex, sliderToZoom, zoomToSlider } from '../model/timelineView';
import { formatDuration, formatTimecode, type Frames } from '../model/time';
import type { FrameInfo, PreviewCandidate, PreviewController } from '../playback/PreviewController';
import { Gallery } from './Gallery';
import { isMac, isTextEntry, modKey } from './hooks';
import { Inspector } from './Inspector';
import { LibraryPanel } from './LibraryPanel';
import { Timeline, type Selection, type TimelineApi } from './Timeline';
import { TransitionsPanel } from './TransitionsPanel';

interface Props {
  baseDoc: Doc;
  sources: readonly Source[];
  store: FrameStore;
  controller: PreviewController;
  ready: boolean;
  reducedMotion: boolean;
  announce: (text: string) => void;
  /** Shell slots this editor renders into. */
  sidebarEl: HTMLElement;
  timelineEl: HTMLElement;
}

type Tab = 'library' | 'transitions';
type FocusTarget =
  | { kind: 'cut'; key: string }
  | { kind: 'transition'; id: string }
  | { kind: 'picker' }
  | { kind: 'edit' }
  | { kind: 'change' };

/** A preset tile being dragged toward the timeline; `cutKey` is the cut under the pointer. */
interface PresetDrag {
  readonly presetId: string;
  readonly x: number;
  readonly y: number;
  readonly cutKey: string | null;
}

const TAB_KEY = 'transition-study.tab';
const pad3 = (n: number) => String(n).padStart(3, '0');

function readTab(): Tab {
  try {
    return localStorage.getItem(TAB_KEY) === 'library' ? 'library' : 'transitions';
  } catch {
    return 'transitions';
  }
}

const NO_CUTS = 'Add another clip from the Library to make a cut, then add a transition there.';
const NO_TARGET = 'Click + between two clips to choose a cut, or drag a preset onto a cut.';

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
export function Editor({ baseDoc, sources, store, controller, ready, reducedMotion, announce, sidebarEl, timelineEl }: Props) {
  const [history, setHistory] = useState<History<Doc>>(() => createHistory(baseDoc));
  const doc = history.present;

  const [playhead, setPlayhead] = useState<Frames>(0);
  const [playing, setPlaying] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  /** Level 1 opened from level 2 to swap the selected transition's preset. */
  const [changing, setChanging] = useState(false);
  const [targetCutKey, setTargetCutKey] = useState<string | null>(null);
  const [tab, setTabState] = useState<Tab>(readTab);
  const [pickerActive, setPickerActive] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [preview, setPreview] = useState({ active: false, playing: false });
  const [looping, setLooping] = useState(false);
  const [zoom, setZoom] = useState<number | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [libDrag, setLibDrag] = useState<{ sourceId: string; x: number; y: number; index: number | null } | null>(null);
  const [presetDrag, setPresetDrag] = useState<PresetDrag | null>(null);
  const [, setFocusTick] = useState(0);

  const readoutRef = useRef<HTMLOutputElement>(null);
  const pickerListRef = useRef<HTMLDivElement>(null);
  const editHeadingRef = useRef<HTMLHeadingElement>(null);
  const changeRef = useRef<HTMLButtonElement>(null);
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ library: null, transitions: null });
  const [cutEls] = useState(() => new Map<string, HTMLButtonElement>());
  const [transitionEls] = useState(() => new Map<string, HTMLButtonElement>());
  const timelineApi = useRef<TimelineApi>(null);
  const pendingFocus = useRef<FocusTarget | null>(null);
  const libDragRef = useRef(libDrag);
  libDragRef.current = libDrag;
  const presetDragRef = useRef(presetDrag);
  presetDragRef.current = presetDrag;
  const feelGesture = useRef(false);
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
  const view = sidebarView({ hasTransition: !!selectedTransition, selected: !!selectedTransition, changing });
  const len = timelineLength(doc);
  const ppf = zoom ?? fitScale(len, viewportWidth);
  const sourceIndex = useMemo(() => new Map(sources.map((s, i) => [s.id, i] as const)), [sources]);
  const sourceTone = useCallback((id: string) => sourceIndex.get(id) ?? 0, [sourceIndex]);
  const sourceLabel = useCallback((id: string) => sources.find((s) => s.id === id)?.label ?? id, [sources]);
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

  const formatInfo = useCallback(
    (info: FrameInfo): string => {
      const ref = (r: FrameRef) => `${sourceLabel(r.sourceId)} src ${pad3(r.frame)}`;
      const parts: string[] = [];
      parts.push(info.mode === 'preview' && info.presetId ? `Preview · ${getPreset(info.presetId).name}` : 'Timeline');
      parts.push(`T ${formatTimecode(info.t)} (f${info.t})`);
      if (info.source) parts.push(ref(info.source));
      if (info.from) parts.push(ref(info.from));
      if (info.to) parts.push(ref(info.to));
      if (info.linear !== undefined && info.eased !== undefined) parts.push(`p ${info.linear.toFixed(2)} → ${info.eased.toFixed(2)}`);
      if (!info.exact) parts.push('≈ nearest decoded frame');
      return parts.join(' · ');
    },
    [sourceLabel],
  );

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
      onFrameInfo: (info) => {
        if (readoutRef.current) readoutRef.current.textContent = formatInfo(info);
      },
    });
    return () => controller.setCallbacks(null);
  }, [controller, formatInfo]);

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
    if (!exists) {
      setSelection(null);
      setChanging(false);
    }
  }, [doc, selection]);

  // Forget a target cut that no longer exists, so it can't come back on redo unasked.
  useEffect(() => {
    if (targetCutKey && !cutByKey(doc, targetCutKey)) setTargetCutKey(null);
  }, [doc, targetCutKey]);

  // The loop control lives in level 2; leaving it stops the loop.
  useEffect(() => {
    if (view === 'pick' && looping) controller.endPreview();
  }, [controller, view, looping]);

  // Keep the selected-transition loop in sync with Feel / duration edits.
  const loopCut = selectedTransition ? transitionCutKey(selectedTransition) : null;
  const loopPreset = selectedTransition?.presetId;
  const loopDuration = selectedTransition?.duration;
  const loopFeel = selectedTransition?.feel;
  useEffect(() => {
    if (!looping) return;
    if (!loopCut || loopPreset === undefined || loopDuration === undefined || loopFeel === undefined) {
      controller.endPreview();
      return;
    }
    controller.preview(
      { cutKey: loopCut, presetId: loopPreset, duration: loopDuration, feel: loopFeel },
      { autoplay: true, once: reducedMotion },
    );
  }, [controller, looping, loopCut, loopPreset, loopDuration, loopFeel, reducedMotion]);

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
            : target.kind === 'edit'
              ? editHeadingRef.current
              : changeRef.current;
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
      setChanging(false);
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

  /** + at a cut: target it and move into the level-1 picker. */
  const chooseAtCut = (key: string) => {
    if (!ready) return;
    controller.pause();
    setTargetCutKey(key);
    setSelection(null);
    setChanging(false);
    setTab('transitions');
    requestFocus({ kind: 'picker' });
    const cut = cutByKey(doc, key);
    if (cut) {
      const l = getLimits(doc, cut);
      if (!l.canTransition) announce(describeNoHandles(cut, l));
    }
  };

  /** Level 2 → level 1 to swap the selected transition's preset. */
  const startChange = () => {
    controller.endPreview();
    controller.pause();
    setChanging(true);
    requestFocus({ kind: 'picker' });
  };

  /** Esc from the picker (or globally while swapping). */
  const leavePicker = () => {
    controller.endPreview();
    setPreviewId(null);
    if (changing) {
      setChanging(false);
      requestFocus({ kind: 'change' });
    } else if (targetTransition) {
      requestFocus({ kind: 'transition', id: targetTransition.id });
    } else if (targetCut) {
      requestFocus({ kind: 'cut', key: targetCut.key });
    }
  };

  // --- transition actions ------------------------------------------------------

  /** What applying `presetId` at `cut` would look like: an existing transition keeps its duration and Feel. */
  const candidateAt = (cut: Cut, presetId: string): PreviewCandidate | null => {
    const l = getLimits(doc, cut);
    if (!l.canTransition) return null;
    const t = transitionAt(doc, cut.key);
    if (t) return { cutKey: cut.key, presetId, duration: t.duration, feel: t.feel };
    const feel = TRANSITION_DEFAULTS.feel;
    return { cutKey: cut.key, presetId, duration: feelToParams(feel, getPreset(presetId).feel, l).duration, feel };
  };

  const onPreview = (id: string) => {
    const c = targetCut ? candidateAt(targetCut, id) : null;
    if (!c) return;
    setPreviewId(id);
    controller.preview(c, { autoplay: !reducedMotion, once: false });
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
    const r = applyTransition(doc, target.key, id, preset.feel, { feel: TRANSITION_DEFAULTS.feel });
    if (!r.ok) {
      if (r.limits) announce(describeNoHandles(target, r.limits));
      return;
    }
    if (r.doc !== doc) commitDoc(r.doc, r.replaced ? `Change to ${preset.name}` : `Apply ${preset.name}`);
    controller.endPreview();
    setPreviewId(null);
    setTargetCutKey(target.key);
    setSelection({ kind: 'transition', id: r.transition.id });
    setChanging(false);
    setTab('transitions');
    requestFocus({ kind: 'edit' });
    const cut = cutByKey(r.doc, target.key)!;
    const capped = r.clamped === 'max' ? ` ${describeLimit(cut, getLimits(r.doc, cut))}.` : '';
    if (r.doc === doc) announce(`${preset.name} selected`);
    else if (r.replaced) announce(`Changed to ${preset.name}: ${formatDuration(r.transition.duration)}, Feel kept.${capped}`);
    else announce(`${preset.name} applied: ${formatDuration(r.transition.duration)}, centred on the cut.${capped}`);
  };

  const removeTransitionAt = (cutKey: string) => {
    const t = transitionAt(doc, cutKey);
    if (!t) return;
    const name = getPreset(t.presetId).name;
    controller.endPreview();
    commitDoc(removeTransition(doc, cutKey), `Remove ${name}`);
    setSelection(null);
    setChanging(false);
    // Stay on the cut, so another preset can go straight back on.
    setTargetCutKey(cutKey);
    requestFocus({ kind: 'cut', key: cutKey });
    announce(`${name} removed`);
  };

  const onFeelPointerDown = () => {
    if (feelGesture.current) return;
    feelGesture.current = true;
    gesture.begin();
    const end = () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      feelGesture.current = false;
      gesture.end('Change feel');
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };

  const onFeelInput = (value: number) => {
    const t = selectedTransition;
    if (!t) return;
    const r = setFeel(doc, transitionCutKey(t), value, getPreset(t.presetId).feel);
    if (feelGesture.current) gesture.update(r.doc);
    else commitDoc(r.doc, 'Change feel');
  };

  const onStepDuration = (cutKey: string, requested: Frames) => {
    const r = setDuration(doc, cutKey, requested);
    if (r.doc !== doc) commitDoc(r.doc, 'Change duration');
    return r;
  };

  // --- clip actions ------------------------------------------------------------

  const labelOf = (id: string) => doc.clips.find((c) => c.id === id)?.label ?? 'clip';

  const insertSource = (sourceId: string, index: number) => {
    const source = sources.find((s) => s.id === sourceId);
    if (!source) return;
    controller.endPreview();
    const r = insertClip(doc, source, index, LIBRARY_INSERT);
    commitDoc(r.doc, `Add ${source.label}`);
    setSelection({ kind: 'clip', id: r.clip.id });
    setChanging(false);
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
    const r = deleteClip(doc, selection.id);
    if (!r.ok) {
      announce('The timeline needs at least one clip');
      return;
    }
    controller.endPreview();
    commitDoc(r.doc, `Delete ${label}`);
    setSelection(null);
    setTargetCutKey(null);
    announce(`${label} deleted`);
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
    if (controller.isPreviewing) controller.togglePreviewPlayback();
    else controller.togglePlay();
  };

  const onScrubStart = () => {
    controller.pause();
    controller.endPreview();
  };

  // --- global shortcuts --------------------------------------------------------

  const hasTarget = targetCutKey !== null;
  const shortcuts = { doUndo, doRedo, togglePlay, deleteSelected, leavePicker, select, doSplit, onPresetDragEnd, selection, hasTarget, changing, looping };
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
      } else if (e.key === 'Escape') {
        if (libDragRef.current) setLibDrag(null);
        else if (presetDragRef.current) s.onPresetDragEnd(false);
        else if (s.changing) s.leavePicker();
        else if (s.looping) controller.endPreview();
        else if (s.selection || s.hasTarget) s.select(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [controller]);

  // --- render ----------------------------------------------------------------

  const mod = modKey;
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
  const dragNote = !dragCut
    ? 'Drop on a cut'
    : !dragValid
      ? `No handles at Cut ${dragCut.index + 1}`
      : `${transitionAt(doc, dragCut.key) ? 'Replace at' : 'Apply to'} Cut ${dragCut.index + 1}`;

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
            store={store}
            ready={ready}
            sourceTone={sourceTone}
            onDragStart={onLibDragStart}
            onDragMove={onLibDragMove}
            onDragEnd={onLibDragEnd}
            onAdd={(id) => insertSource(id, insertionIndex(doc, playhead))}
          />
        ) : (
          <TransitionsPanel
            view={view}
            presetName={targetTransition ? getPreset(targetTransition.presetId).name : null}
            changing={changing}
            cutLabel={cutLabel}
            editHeadingRef={editHeadingRef}
            onChange={startChange}
            onBack={leavePicker}
          >
            {view === 'edit' && selectedTransition && selectedCut && limits ? (
              <Inspector
                cut={selectedCut}
                transition={selectedTransition}
                limits={limits}
                looping={looping}
                changeRef={changeRef}
                onFeelPointerDown={onFeelPointerDown}
                onFeelInput={onFeelInput}
                onChangePreset={startChange}
                onRemove={() => removeTransitionAt(selectedCut.key)}
                onToggleLoop={() => (looping ? controller.endPreview() : setLooping(true))}
              />
            ) : (
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
                reducedMotion={reducedMotion}
                previewActive={preview.active}
                previewPlaying={preview.playing}
                onPreview={onPreview}
                onLeave={onLeavePreview}
                onApply={onApply}
                onEscape={leavePicker}
                onTogglePreview={() => controller.togglePreviewPlayback()}
                onActiveChange={setPickerActive}
              />
            )}
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
            {formatTimecode(playhead)} <span className="muted">f{playhead}</span>
          </span>
          <span className="bar-divider" aria-hidden="true" />
          <button
            type="button"
            className="btn-icon"
            onClick={doUndo}
            disabled={!canUndo(history)}
            aria-label={canUndo(history) ? `Undo ${undoLabel(history)}` : 'Undo'}
            title={canUndo(history) ? `Undo ${undoLabel(history)} (${mod}Z)` : 'Nothing to undo'}
            aria-keyshortcuts={isMac ? 'Meta+Z' : 'Control+Z'}
          >
            <span aria-hidden="true">↶</span>
          </button>
          <button
            type="button"
            className="btn-icon"
            onClick={doRedo}
            disabled={!canRedo(history)}
            aria-label={canRedo(history) ? `Redo ${redoLabel(history)}` : 'Redo'}
            title={canRedo(history) ? `Redo ${redoLabel(history)} (⇧${mod}Z)` : 'Nothing to redo'}
            aria-keyshortcuts={isMac ? 'Shift+Meta+Z' : 'Shift+Control+Z'}
          >
            <span aria-hidden="true">↷</span>
          </button>
          <button
            type="button"
            className="btn-icon"
            onClick={doSplit}
            disabled={!ready || !splitCheck.ok}
            aria-label={splitReason ? `Split at playhead (${splitReason})` : 'Split at playhead'}
            title={splitReason ?? 'Split the clip at the playhead (S)'}
            aria-keyshortcuts="S"
          >
            <BladeGlyph />
          </button>
        </div>
        <button
          type="button"
          className="btn-play"
          onClick={() => controller.togglePlay()}
          aria-label={playing ? 'Pause' : 'Play'}
          aria-keyshortcuts="Space"
          disabled={!ready}
        >
          <span aria-hidden="true">{playing ? '❚❚' : '▶'}</span>
        </button>
        <div className="bar-right">
          {reducedMotion && <span className="badge">Reduced motion: previews play on request</span>}
          <output ref={readoutRef} className="frame-readout" />
          <span className="bar-divider" aria-hidden="true" />
          <div className="zoom" role="group" aria-label="Timeline zoom">
            <button type="button" className="btn-icon" onClick={() => setZoom(clampZoom(ppf / 1.25))} aria-label="Zoom out">
              <span aria-hidden="true">−</span>
            </button>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={zoomSlider}
              aria-label="Zoom"
              aria-valuetext={`${ppf.toFixed(2)} pixels per frame${zoom === null ? ', fit to width' : ''}`}
              onChange={(e) => setZoom(sliderToZoom(Number(e.currentTarget.value)))}
            />
            <button type="button" className="btn-icon" onClick={() => setZoom(clampZoom(ppf * 1.25))} aria-label="Zoom in">
              <span aria-hidden="true">+</span>
            </button>
            <button type="button" className="btn btn-small" onClick={() => setZoom(null)} aria-pressed={zoom === null}>
              Fit
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
        pickerActive={tab === 'transitions' && view === 'pick' && (pickerActive || preview.active)}
        pickerId={pickerId}
        dropIndex={libDrag?.index ?? null}
        dropCutKey={dragCut?.key ?? null}
        dropCutValid={dragValid}
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
      {createPortal(timeline, timelineEl)}
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

/** A blade cutting a strip: the split tool glyph. */
function BladeGlyph() {
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
      <rect x="2" y="7" width="16" height="6" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10 2.5v15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
