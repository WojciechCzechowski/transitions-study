import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent, type Ref } from 'react';
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
  /** The listbox; the editor focuses its current tab stop from + at the cut. */
  listRef: Ref<HTMLDivElement>;
  /** Id for the listbox, so the cut handle can point at it. */
  listId: string;
  reducedMotion: boolean;
  previewActive: boolean;
  previewPlaying: boolean;
  onPreview: (id: string) => void;
  onLeave: () => void;
  onApply: (id: string) => void;
  onEscape: () => void;
  onTogglePreview: () => void;
  /** Pointer over the picker or focus inside it. */
  onActiveChange: (active: boolean) => void;
}

/**
 * Level-1 preset picker in the sidebar. Roving focus: one tab stop, arrow keys
 * move and preview, Enter applies, Esc goes back, Space plays/pauses the
 * preview. Previews revert only when the pointer leaves the whole picker or
 * focus moves outside it, so moving between tiles never flashes the timeline.
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
  const active = useRef({ pointer: false, focus: false });

  const setActive = (part: 'pointer' | 'focus', value: boolean) => {
    const before = active.current.pointer || active.current.focus;
    active.current = { ...active.current, [part]: value };
    const after = active.current.pointer || active.current.focus;
    if (before !== after) props.onActiveChange(after);
  };

  // Unmounting (apply → level 2) never fires leave/blur, so report inactive here.
  const onActiveChange = useRef(props.onActiveChange);
  onActiveChange.current = props.onActiveChange;
  useEffect(
    () => () => {
      if (active.current.pointer || active.current.focus) onActiveChange.current(false);
    },
    [],
  );

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
      props.onEscape();
    } else if (e.key === ' ' && !e.repeat) {
      e.preventDefault();
      e.stopPropagation();
      if (!disabled) props.onTogglePreview();
    }
  };

  const onBlur = (e: FocusEvent) => {
    if (rootRef.current?.contains(e.relatedTarget as Node | null)) return;
    setActive('focus', false);
    props.onLeave();
  };

  const previewName = presets.find((p) => p.id === previewId)?.name;
  const playLabel = previewPlaying ? 'Pause preview' : 'Play preview';

  return (
    <div
      ref={rootRef}
      className="gallery"
      role="group"
      aria-label="Transition picker"
      onPointerEnter={() => setActive('pointer', true)}
      onPointerLeave={() => {
        setActive('pointer', false);
        props.onLeave();
      }}
      onFocus={() => setActive('focus', true)}
      onBlur={onBlur}
      onKeyDown={onRootKeyDown}
    >
      {disabled ? (
        <p className="notice" id={noticeId} role="note">
          {disabledReason}
        </p>
      ) : (
        <div className="gallery-head">
          <span className="gallery-status" aria-live="polite">
            {previewName ? `Previewing ${previewName}` : reducedMotion ? 'Focus a preset to see it at the cut' : 'Hover a preset to preview it'}
          </span>
          <span className="spacer" />
          <button
            type="button"
            className="btn btn-small"
            onClick={props.onTogglePreview}
            disabled={!previewActive}
            aria-keyshortcuts="Space"
          >
            {playLabel}
          </button>
        </div>
      )}
      <div
        ref={props.listRef}
        id={props.listId}
        className="gallery-list"
        role="listbox"
        aria-label="Transition presets"
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
            <span className="preset-thumb">
              <PresetIcon id={p.id} />
              {appliedId === p.id && <span className="preset-badge">Applied</span>}
            </span>
            <span className="preset-name">{p.name}</span>
            <span className="preset-hint">{p.hint}</span>
          </div>
        ))}
      </div>
      <p className="gallery-keys muted" id={hintId}>
        Arrows move and preview · Enter apply · Space play/pause · Esc back
      </p>
    </div>
  );
}
