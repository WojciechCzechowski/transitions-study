import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getPreset, PRESETS, TRANSITION_DEFAULTS } from '../config/transitions.config';
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
import { applyTransition, removeTransition, setDuration, setFeel } from '../model/ops';
import { docEquals, getLimits, type Doc, type Transition } from '../model/timeline';
import { formatDuration, formatTimecode, type Frames } from '../model/time';
import type { FrameInfo, PreviewCandidate, PreviewController } from '../playback/PreviewController';
import { Gallery } from './Gallery';
import { Inspector } from './Inspector';
import { Timeline } from './Timeline';
import { TransitionsPanel } from './TransitionsPanel';

interface Props {
  baseDoc: Doc;
  controller: PreviewController;
  ready: boolean;
  reducedMotion: boolean;
  announce: (text: string) => void;
  /** Shell slots this editor renders into. */
  sidebarEl: HTMLElement;
  timelineEl: HTMLElement;
}

const pad3 = (n: number) => String(n).padStart(3, '0');

function formatInfo(info: FrameInfo): string {
  const parts: string[] = [];
  parts.push(info.mode === 'preview' && info.presetId ? `Preview · ${getPreset(info.presetId).name}` : 'Timeline');
  parts.push(`T ${formatTimecode(info.t)} (f${info.t})`);
  if (info.a !== undefined) parts.push(`A src ${pad3(info.a)}`);
  if (info.b !== undefined) parts.push(`B src ${pad3(info.b)}`);
  if (info.linear !== undefined && info.eased !== undefined) {
    parts.push(`p ${info.linear.toFixed(2)} → ${info.eased.toFixed(2)}`);
  }
  if (!info.exact) parts.push('≈ nearest decoded frame');
  return parts.join(' · ');
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/**
 * Owns the undoable document and the interaction state for one scenario.
 * Remounted (via key) when the scenario changes, which resets history. Renders
 * the Transitions sidebar and the timeline pane into the shell's slots.
 */
export function Editor({ baseDoc, controller, ready, reducedMotion, announce, sidebarEl, timelineEl }: Props) {
  const [history, setHistory] = useState<History<Doc>>(() => createHistory(baseDoc));
  const doc = history.present;
  const limits = useMemo(() => getLimits(doc), [doc]);

  const [playhead, setPlayhead] = useState<Frames>(0);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState(false);
  /** Level 1 opened from level 2 to swap the applied preset. */
  const [changing, setChanging] = useState(false);
  const [pickerActive, setPickerActive] = useState(false);
  const [, setFocusTick] = useState(0);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [preview, setPreview] = useState({ active: false, playing: false });
  const [looping, setLooping] = useState(false);

  const readoutRef = useRef<HTMLOutputElement>(null);
  const cutHandleRef = useRef<HTMLButtonElement>(null);
  const transitionRef = useRef<HTMLButtonElement>(null);
  const pickerListRef = useRef<HTMLDivElement>(null);
  const editHeadingRef = useRef<HTMLHeadingElement>(null);
  const changeRef = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<'transition' | 'cut' | 'picker' | 'edit' | 'change' | null>(null);
  const pickerId = useId();
  const view = sidebarView({ hasTransition: !!doc.transition, selected, changing });
  const feelGesture = useRef(false);

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
      onFrameInfo: (info) => {
        if (readoutRef.current) readoutRef.current.textContent = formatInfo(info);
      },
    });
    return () => controller.setCallbacks(null);
  }, [controller]);

  useLayoutEffect(() => controller.setDoc(doc), [controller, doc]);
  useLayoutEffect(() => controller.setPlayhead(playhead), [controller, playhead]);
  useEffect(() => () => controller.endPreview(), [controller]);

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

  useEffect(() => {
    if (doc.transition) return;
    setSelected(false);
    setChanging(false);
  }, [doc.transition]);

  // The loop control lives in level 2; leaving it stops the loop.
  useEffect(() => {
    if (view === 'pick' && looping) controller.endPreview();
  }, [controller, view, looping]);

  // Keep the applied-transition loop in sync with Feel / duration edits.
  useEffect(() => {
    if (!looping) return;
    if (!doc.transition) {
      controller.endPreview();
      return;
    }
    const { presetId, duration, feel } = doc.transition;
    controller.preview({ presetId, duration, feel }, { autoplay: true, once: reducedMotion });
  }, [controller, looping, doc.transition, reducedMotion]);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    const el =
      target === 'picker'
        ? pickerListRef.current?.querySelector<HTMLElement>('[tabindex="0"]')
        : { transition: transitionRef, cut: cutHandleRef, edit: editHeadingRef, change: changeRef }[target].current;
    el?.focus({ preventScroll: true });
  });

  // --- actions ---------------------------------------------------------------

  const candidateFor = useCallback(
    (presetId: string): PreviewCandidate => {
      const t = doc.transition;
      if (t) return { presetId, duration: t.duration, feel: t.feel };
      const feel = TRANSITION_DEFAULTS.feel;
      return { presetId, duration: feelToParams(feel, getPreset(presetId).feel, limits).duration, feel };
    },
    [doc.transition, limits],
  );

  const requestFocus = (target: NonNullable<typeof pendingFocus.current>) => {
    pendingFocus.current = target;
    setFocusTick((n) => n + 1);
  };

  /** Selection drives the sidebar level; any selection change ends a swap. */
  const select = useCallback((value: boolean) => {
    setSelected(value);
    setChanging(false);
  }, []);

  /** + at the cut: move into the level-1 picker. */
  const chooseAtCut = () => {
    if (!ready) return;
    controller.pause();
    requestFocus('picker');
    if (!limits.canTransition) announce(describeNoHandles(doc, limits));
  };

  /** Level 2 → level 1 to swap the applied preset. */
  const startChange = () => {
    controller.endPreview();
    controller.pause();
    setChanging(true);
    requestFocus('picker');
  };

  /** Esc from the picker (or globally while swapping). */
  const leavePicker = () => {
    controller.endPreview();
    setPreviewId(null);
    if (changing) {
      setChanging(false);
      requestFocus('change');
    } else {
      requestFocus(doc.transition ? 'transition' : 'cut');
    }
  };

  const onPreview = (id: string) => {
    if (!limits.canTransition) return;
    setPreviewId(id);
    controller.preview(candidateFor(id), { autoplay: !reducedMotion, once: false });
  };

  const onLeavePreview = () => {
    controller.endPreview();
    setPreviewId(null);
  };

  const onApply = (id: string) => {
    const preset = getPreset(id);
    const r = applyTransition(doc, id, preset.feel, { feel: TRANSITION_DEFAULTS.feel });
    if (!r.ok) {
      announce(describeNoHandles(doc, r.limits));
      return;
    }
    if (r.doc !== doc) commitDoc(r.doc, r.replaced ? `Change to ${preset.name}` : `Apply ${preset.name}`);
    controller.endPreview();
    setPreviewId(null);
    select(true);
    requestFocus('edit');
    const t = r.doc.transition!;
    const capped = r.clamped === 'max' ? ` ${describeLimit(r.doc, getLimits(r.doc))}.` : '';
    if (r.doc === doc) announce(`${preset.name} selected`);
    else if (r.replaced) announce(`Changed to ${preset.name}: ${formatDuration(t.duration)}, Feel kept.${capped}`);
    else announce(`${preset.name} applied: ${formatDuration(t.duration)}, centred on the cut.${capped}`);
  };

  const removeCurrent = () => {
    const t = doc.transition;
    if (!t) return;
    const name = getPreset(t.presetId).name;
    controller.endPreview();
    commitDoc(removeTransition(doc), `Remove ${name}`);
    select(false);
    requestFocus('cut');
    announce(`${name} removed`);
  };

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
    const t = doc.transition;
    if (!t) return;
    const r = setFeel(doc, value, getPreset(t.presetId).feel);
    if (feelGesture.current) gesture.update(r.doc);
    else commitDoc(r.doc, 'Change feel');
  };

  const onStepDuration = (requested: Frames) => {
    const r = setDuration(doc, requested);
    if (r.doc !== doc) commitDoc(r.doc, 'Change duration');
    return r;
  };

  const onScrubStart = () => {
    controller.pause();
    controller.endPreview();
  };

  // --- global shortcuts --------------------------------------------------------

  const latest = useRef({ doUndo, doRedo, togglePlay, removeCurrent, leavePicker, select, selected, changing, looping, hasTransition: !!doc.transition });
  useLayoutEffect(() => {
    latest.current = { doUndo, doRedo, togglePlay, removeCurrent, leavePicker, select, selected, changing, looping, hasTransition: !!doc.transition };
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = latest.current;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      const textEntry =
        (tag === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes((el as HTMLInputElement).type)) ||
        tag === 'TEXTAREA' ||
        !!el?.isContentEditable;
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
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && s.selected && s.hasTransition) {
        e.preventDefault();
        s.removeCurrent();
      } else if (e.key === 'Escape') {
        if (s.changing) s.leavePicker();
        else if (s.looping) controller.endPreview();
        else if (s.selected) s.select(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [controller]);

  // --- render ----------------------------------------------------------------

  const t: Transition | null = doc.transition;
  const presetName = t ? getPreset(t.presetId).name : null;
  const mod = isMac ? '⌘' : 'Ctrl';

  const sidebar = (
    <TransitionsPanel
      view={view}
      presetName={presetName}
      changing={changing}
      editHeadingRef={editHeadingRef}
      onChange={startChange}
      onBack={leavePicker}
      footer={
        <p className="shortcuts muted">
          <kbd>Space</kbd> play/pause · <kbd>{mod}</kbd>
          <kbd>Z</kbd> undo · <kbd>⇧</kbd>
          <kbd>{mod}</kbd>
          <kbd>Z</kbd> redo · <kbd>Delete</kbd> removes the selected transition · drag the ruler to scrub (←→ steps frames)
        </p>
      }
    >
      {view === 'edit' && t ? (
        <Inspector
          doc={doc}
          transition={t}
          limits={limits}
          looping={looping}
          changeRef={changeRef}
          onFeelPointerDown={onFeelPointerDown}
          onFeelInput={onFeelInput}
          onChangePreset={startChange}
          onRemove={removeCurrent}
          onToggleLoop={() => (looping ? controller.endPreview() : setLooping(true))}
        />
      ) : (
        <Gallery
          presets={PRESETS}
          appliedId={t?.presetId ?? null}
          previewId={previewId}
          disabledReason={limits.canTransition ? null : describeNoHandles(doc, limits)}
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
  );

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
        </div>
      </div>

      <Timeline
        doc={doc}
        limits={limits}
        playhead={playhead}
        ready={ready}
        selected={selected}
        pickerActive={view === 'pick' && (pickerActive || preview.active)}
        pickerId={pickerId}
        cutHandleRef={cutHandleRef}
        transitionRef={transitionRef}
        onScrubStart={onScrubStart}
        onScrub={setPlayhead}
        onSelect={select}
        onChooseAtCut={chooseAtCut}
        gesture={gesture}
        onStepDuration={onStepDuration}
        announce={announce}
      />
    </>
  );

  return (
    <>
      {createPortal(sidebar, sidebarEl)}
      {createPortal(timeline, timelineEl)}
    </>
  );
}
