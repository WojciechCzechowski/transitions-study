import { useEffect, useId, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent } from 'react';
import type { PresetConfig } from '../config/transitions.config';
import { nextGalleryIndex } from '../model/galleryNav';
import { lastInputWasKeyboard } from './hooks';
import { PresetIcon } from './PresetIcon';

interface Props {
  presets: readonly PresetConfig[];
  appliedId: string | null;
  previewId: string | null;
  /** When set, presets are shown but cannot be previewed or applied. */
  disabledReason: string | null;
  /** Horizontal position of the cut, in % of the timeline width. */
  anchorPct: number;
  reducedMotion: boolean;
  previewActive: boolean;
  previewPlaying: boolean;
  onPreview: (id: string) => void;
  onLeave: () => void;
  onApply: (id: string) => void;
  onClose: () => void;
  onTogglePreview: () => void;
}

/**
 * Preset gallery. Roving focus: one tab stop, arrow keys move and preview,
 * Enter applies, Esc closes, Space plays/pauses the preview. Previews revert
 * only when the pointer leaves the whole gallery or focus moves outside it,
 * so moving between tiles never flashes the timeline state.
 */
export function Gallery(props: Props) {
  const { presets, appliedId, previewId, disabledReason, reducedMotion, previewActive, previewPlaying } = props;
  const initial = Math.max(0, presets.findIndex((p) => p.id === appliedId));
  const [focusIndex, setFocusIndex] = useState(initial);
  const items = useRef<(HTMLDivElement | null)[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const noticeId = useId();
  const disabled = disabledReason !== null;

  useEffect(() => {
    // Focus once, on open.
    items.current[initial]?.focus({ preventScroll: true });
  }, []);

  const focusItem = (i: number) => {
    setFocusIndex(i);
    items.current[i]?.focus({ preventScroll: true });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const next = nextGalleryIndex(focusIndex, e.key, presets.length);
    if (next !== null) {
      e.preventDefault();
      e.stopPropagation();
      focusItem(next);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      props.onApply(presets[focusIndex]!.id);
    }
  };

  const onRootKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      props.onClose();
    } else if (e.key === ' ' && !e.repeat) {
      e.preventDefault();
      e.stopPropagation();
      if (!disabled) props.onTogglePreview();
    }
  };

  const onBlur = (e: FocusEvent) => {
    if (!rootRef.current?.contains(e.relatedTarget as Node | null)) props.onLeave();
  };

  const previewName = presets.find((p) => p.id === previewId)?.name;
  const playLabel = previewPlaying ? 'Pause preview' : 'Play preview';

  return (
    <div
      ref={rootRef}
      className="gallery"
      role="group"
      aria-label="Transitions"
      style={{ '--anchor': `${props.anchorPct}%` } as CSSProperties}
      onPointerLeave={props.onLeave}
      onBlur={onBlur}
      onKeyDown={onRootKeyDown}
    >
      <div className="gallery-head">
        <span className="gallery-title">Transitions</span>
        <span className="gallery-status" aria-live="polite">
          {disabled ? '' : previewName ? `Previewing ${previewName}` : reducedMotion ? 'Focus a preset to see it at the cut' : 'Hover a preset to preview it'}
        </span>
        <span className="spacer" />
        {!disabled && (
          <button
            type="button"
            className="btn btn-small"
            onClick={props.onTogglePreview}
            disabled={!previewActive}
            aria-keyshortcuts="Space"
          >
            {playLabel}
          </button>
        )}
        <button type="button" className="btn btn-small btn-quiet" onClick={props.onClose} aria-label="Close transitions" aria-keyshortcuts="Escape">
          ✕
        </button>
      </div>
      {disabled && (
        <p className="notice" id={noticeId} role="note">
          {disabledReason}
        </p>
      )}
      <div
        className="gallery-list"
        role="listbox"
        aria-label="Transition presets"
        aria-orientation="horizontal"
        aria-describedby={disabled ? `${noticeId} ${hintId}` : hintId}
        onKeyDown={onKeyDown}
      >
        {presets.map((p, i) => (
          <div
            key={p.id}
            ref={(el) => {
              items.current[i] = el;
            }}
            role="option"
            className={`preset${previewId === p.id ? ' previewing' : ''}${appliedId === p.id ? ' applied' : ''}`}
            tabIndex={i === focusIndex ? 0 : -1}
            aria-selected={appliedId === p.id}
            aria-disabled={disabled || undefined}
            onPointerEnter={() => !disabled && props.onPreview(p.id)}
            onFocus={() => {
              setFocusIndex(i);
              if (!disabled && lastInputWasKeyboard()) props.onPreview(p.id);
            }}
            onClick={() => props.onApply(p.id)}
          >
            <PresetIcon id={p.id} />
            <span className="preset-name">{p.name}</span>
            <span className="preset-hint">{appliedId === p.id ? 'Applied' : p.hint}</span>
          </div>
        ))}
      </div>
      <p className="gallery-keys muted" id={hintId}>
        ←→ move and preview · Enter apply · Space play/pause · Esc close
      </p>
    </div>
  );
}
