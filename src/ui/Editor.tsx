import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { describeLimit, describeNoHandles } from '../model/messages';
import { applyTransition, removeTransition, setDuration, setFeel } from '../model/ops';
import { cutFrame, docEquals, getLimits, timelineLength, type Doc, type Transition } from '../model/timeline';
import { formatDuration, formatTimecode, type Frames } from '../model/time';
import type { FrameInfo, PreviewCandidate, PreviewController } from '../playback/PreviewController';
import { Gallery } from './Gallery';
import { Inspector } from './Inspector';
import { Timeline } from './Timeline';

interface Props {
  baseDoc: Doc;
  controller: PreviewController;
  ready: boolean;
  reducedMotion: boolean;
  announce: (text: string) => void;
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
 * Remounted (via key) when the scenario changes, which resets history.
 */
export function Editor({ baseDoc, controller, ready, reducedMotion, announce }: Props) {
  const [history, setHistory] = useState<History<Doc>>(() => createHistory(baseDoc));
  const doc = history.present;
  const limits = useMemo(() => getLimits(doc), [doc]);

  const [playhead, setPlayhead] = useState<Frames>(0);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [preview, setPreview] = useState({ active: false, playing: false });
  const [looping, setLooping] = useState(false);

  const readoutRef = useRef<HTMLOutputElement>(null);
  const cutHandleRef = useRef<HTMLButtonElement>(null);
  const transitionRef = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<'transition' | 'cut' | null>(null);
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
    if (!doc.transition) setSelected(false);
  }, [doc.transition]);

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
    (target === 'transition' ? transitionRef : cutHandleRef).current?.focus({ preventScroll: true });
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

  const openGallery = () => {
    if (!ready) return;
    controller.endPreview();
    controller.pause();
    setGalleryOpen(true);
    if (!limits.canTransition) announce(describeNoHandles(doc, limits));
  };

  const closeGallery = (moveFocus: boolean) => {
    controller.endPreview();
    setPreviewId(null);
    setGalleryOpen(false);
    if (moveFocus) pendingFocus.current = doc.transition ? 'transition' : 'cut';
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
    setGalleryOpen(false);
    setSelected(true);
    pendingFocus.current = 'transition';
    const t = r.doc.transition!;
    const capped = r.clamped === 'max' ? ` ${describeLimit(r.doc, getLimits(r.doc))}.` : '';
    announce(`${preset.name} applied: ${formatDuration(t.duration)}, centred on the cut.${capped}`);
  };

  const removeCurrent = () => {
    const t = doc.transition;
    if (!t) return;
    const name = getPreset(t.presetId).name;
    controller.endPreview();
    commitDoc(removeTransition(doc), `Remove ${name}`);
    setSelected(false);
    pendingFocus.current = 'cut';
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

  const latest = useRef({ doUndo, doRedo, togglePlay, removeCurrent, closeGallery, selected, galleryOpen, looping, hasTransition: !!doc.transition });
  useLayoutEffect(() => {
    latest.current = { doUndo, doRedo, togglePlay, removeCurrent, closeGallery, selected, galleryOpen, looping, hasTransition: !!doc.transition };
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
        if (s.galleryOpen) s.closeGallery(true);
        else if (s.looping) controller.endPreview();
        else if (s.selected) setSelected(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [controller]);

  // Clicking outside the gallery closes it (without moving focus).
  useEffect(() => {
    if (!galleryOpen) return;
    const onDown = (e: PointerEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest('.gallery, .cut-handle, .preview')) return;
      latest.current.closeGallery(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [galleryOpen]);

  // --- render ----------------------------------------------------------------

  const t: Transition | null = doc.transition;
  const len = timelineLength(doc);
  const anchorPct = (100 * cutFrame(doc)) / len;

  return (
    <>
      <div className="transport">
        <button
          type="button"
          className="btn play"
          onClick={() => controller.togglePlay()}
          aria-label={playing ? 'Pause' : 'Play'}
          aria-keyshortcuts="Space"
          disabled={!ready}
        >
          <span aria-hidden="true">{playing ? '❚❚' : '▶'}</span>
        </button>
        <span className="timecode">
          {formatTimecode(playhead)} <span className="muted">f{playhead}</span>
        </span>
        <output ref={readoutRef} className="frame-readout" />
        <span className="spacer" />
        {reducedMotion && <span className="badge">Reduced motion: previews play on request</span>}
      </div>

      <div className="panel">
        {galleryOpen ? (
          <Gallery
            presets={PRESETS}
            appliedId={t?.presetId ?? null}
            previewId={previewId}
            disabledReason={limits.canTransition ? null : describeNoHandles(doc, limits)}
            anchorPct={anchorPct}
            reducedMotion={reducedMotion}
            previewActive={preview.active}
            previewPlaying={preview.playing}
            onPreview={onPreview}
            onLeave={onLeavePreview}
            onApply={onApply}
            onClose={() => closeGallery(true)}
            onTogglePreview={() => controller.togglePreviewPlayback()}
          />
        ) : t ? (
          <Inspector
            doc={doc}
            transition={t}
            limits={limits}
            looping={looping}
            onFeelPointerDown={onFeelPointerDown}
            onFeelInput={onFeelInput}
            onChangePreset={openGallery}
            onRemove={removeCurrent}
            onToggleLoop={() => (looping ? controller.endPreview() : setLooping(true))}
          />
        ) : (
          <div className="hint">
            <p>
              Hover the cut between the clips and click <kbd>+</kbd> to add a transition. Tab to it with the keyboard.
            </p>
            {!limits.canTransition && (
              <p className="notice" role="note">
                {describeNoHandles(doc, limits)}
              </p>
            )}
          </div>
        )}
      </div>

      <Timeline
        doc={doc}
        limits={limits}
        playhead={playhead}
        ready={ready}
        selected={selected}
        galleryOpen={galleryOpen}
        cutHandleRef={cutHandleRef}
        transitionRef={transitionRef}
        onScrubStart={onScrubStart}
        onScrub={setPlayhead}
        onSelect={setSelected}
        onOpenGallery={() => (galleryOpen ? closeGallery(true) : openGallery())}
        gesture={gesture}
        onStepDuration={onStepDuration}
        announce={announce}
      />

      <p className="shortcuts muted">
        <kbd>Space</kbd> play/pause · drag the ruler to scrub (←→ steps frames) · <kbd>{isMac ? '⌘' : 'Ctrl'}</kbd>
        <kbd>Z</kbd> undo · <kbd>⇧</kbd>
        <kbd>{isMac ? '⌘' : 'Ctrl'}</kbd>
        <kbd>Z</kbd> redo · <kbd>Delete</kbd> removes the selected transition
      </p>
    </>
  );
}
