import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent, type PointerEvent, type Ref } from 'react';
import { SlidersHorizontal, Trash } from 'lucide-react';
import type { PresetConfig } from '../config/transitions.config';
import { nextGalleryIndex } from '../model/galleryNav';
import { lastInputWasKeyboard } from './hooks';
import { PresetIcon } from './PresetIcon';

/** The gallery's keyboard controls, shown in the Transitions help popover. */
export const GALLERY_KEYS: readonly { action: string; keys: readonly string[] }[] = [
  { action: 'Move and preview', keys: ['←', '→', '↑', '↓'] },
  { action: 'Apply to the cut', keys: ['Enter'] },
  { action: 'Back', keys: ['Esc'] },
];

/** The same help as one sentence, for the listbox description. */
const helpText = (draggable: boolean) =>
  [
    ...(draggable ? ['Drag a preset onto any cut'] : []),
    ...GALLERY_KEYS.map((k) => `${k.keys.join(' ')} ${k.action.toLowerCase()}`),
  ].join(' · ');

interface Props {
  presets: readonly PresetConfig[];
  appliedId: string | null;
  previewId: string | null;
  /** When set, presets are shown but cannot be previewed or applied by click / Enter. */
  disabledReason: string | null;
  /** 'info' for a prompt (no cut chosen yet), 'warn' for a problem. */
  noticeTone: 'info' | 'warn';
  /** Tiles can be dragged onto any cut in the timeline, even while click-apply is off. */
  draggable: boolean;
  /** The tile being dragged, if any. */
  draggingId: string | null;
  /** Pointer drag lifecycle; the editor hit-tests cuts and draws the ghost. */
  onDragStart: (presetId: string, clientX: number, clientY: number) => void;
  onDragMove: (clientX: number, clientY: number) => void;
  onDragEnd: (commit: boolean) => void;
  /** The listbox; the editor focuses its current tab stop from + at the cut. */
  listRef: Ref<HTMLDivElement>;
  /** Id for the listbox, so the cut handle can point at it. */
  listId: string;
  /** Hovering (or keyboard-focusing) a preset previews it at the cut. A stored preference. */
  previewOnHover: boolean;
  onPreviewOnHoverChange: (on: boolean) => void;
  onPreview: (id: string) => void;
  onLeave: () => void;
  onApply: (id: string) => void;
  onEscape: () => void;
  /** Pointer over the picker or focus inside it. */
  onActiveChange: (active: boolean) => void;
  /** The preset whose settings popover is open. */
  tuningId: string | null;
  /** Per preset: what applying it here would trim off the clips, e.g. "Will trim right clip by 0.70 s (21 f)". */
  trimNotes: Readonly<Record<string, string>>;
  /** The settings button on a card: opens (or closes) that preset's popover. */
  onTune: (id: string) => void;
  /** The trash button on the applied card. */
  onRemove: () => void;
}

/** A bare exclamation mark, drawn like the other line icons. */
function ExclamationMark() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v9" />
      <path d="M12 19h.01" />
    </svg>
  );
}

/** Keeps a press or key on a card's own buttons from also dragging, applying or moving in the list. */
const keepToButton = {
  onPointerDown: (e: PointerEvent) => e.stopPropagation(),
  onKeyDown: (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
  },
};

/**
 * Level-1 preset picker in the sidebar. Roving focus: one tab stop, arrow keys
 * move (and preview, when Preview on hover is on), Enter applies, Esc goes back.
 * Previews revert only when the pointer leaves the whole picker or focus moves
 * outside it, so moving between tiles never flashes the timeline.
 */
const DRAG_THRESHOLD_PX = 4;

export function Gallery(props: Props) {
  const { presets, appliedId, previewId, disabledReason, noticeTone, draggable, draggingId, previewOnHover, tuningId } = props;
  const press = useRef<{ pointerId: number; id: string; x: number; y: number; dragging: boolean } | null>(null);
  /** The last press turned into a drag, so the click that follows it isn't an apply. */
  const dragged = useRef(false);
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
    } else if (e.key === ' ') {
      // No play/pause in the gallery: keep Space from reaching the editor's play shortcut.
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const onTilePointerDown = (e: PointerEvent<HTMLDivElement>, id: string) => {
    dragged.current = false;
    if (e.button !== 0 || !draggable) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current = { pointerId: e.pointerId, id, x: e.clientX, y: e.clientY, dragging: false };
  };
  const onTilePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p || p.pointerId !== e.pointerId) return;
    if (!p.dragging && Math.hypot(e.clientX - p.x, e.clientY - p.y) >= DRAG_THRESHOLD_PX) {
      p.dragging = true;
      dragged.current = true;
      props.onDragStart(p.id, e.clientX, e.clientY);
    }
    if (p.dragging) props.onDragMove(e.clientX, e.clientY);
  };
  const onTilePointerUp = (e: PointerEvent<HTMLDivElement>, cancelled = false) => {
    const p = press.current;
    if (!p || p.pointerId !== e.pointerId) return;
    press.current = null;
    if (p.dragging) props.onDragEnd(!cancelled);
  };

  const onRootKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && press.current?.dragging) {
      // Esc mid-drag cancels the drag only; the pointer-up that follows does nothing.
      e.preventDefault();
      e.stopPropagation();
      press.current = null;
      props.onDragEnd(false);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      props.onEscape();
    }
  };

  const onBlur = (e: FocusEvent) => {
    if (rootRef.current?.contains(e.relatedTarget as Node | null)) return;
    setActive('focus', false);
    props.onLeave();
  };

  const appliedName = presets.find((p) => p.id === appliedId)?.name;
  // A stable label: it changes only with the cut's state, not while presets are hovered.
  const status = appliedName
    ? `Pick a preset to replace ${appliedName}`
    : previewOnHover
      ? 'Hover a preset to preview it'
      : 'Click a preset to apply it';

  return (
    <div
      ref={rootRef}
      className={`gallery${draggable ? ' can-drag' : ''}`}
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
        <p className={`notice${noticeTone === 'info' ? ' info' : ''}`} id={noticeId} role="note">
          {disabledReason}
        </p>
      ) : (
        <div className="gallery-head">
          <span className="gallery-status">
            {status}
          </span>
          <span className="spacer" />
          <button
            type="button"
            role="switch"
            aria-checked={previewOnHover}
            className="switch"
            onClick={() => props.onPreviewOnHoverChange(!previewOnHover)}
            onKeyDown={(e) => {
              // Space toggles the switch itself, not playback.
              if (e.key === ' ') e.stopPropagation();
            }}
          >
            <span className="switch-label">Preview on hover</span>
            <span className="switch-track" aria-hidden="true">
              <span className="switch-knob" />
            </span>
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
            data-preset={p.id}
            className={`preset${previewId === p.id ? ' previewing' : ''}${appliedId === p.id ? ' applied' : ''}${draggingId === p.id ? ' dragging' : ''}${tuningId === p.id ? ' tuning' : ''}`}
            tabIndex={i === focusIndex ? 0 : -1}
            aria-selected={appliedId === p.id}
            aria-disabled={disabled || undefined}
            onPointerEnter={() => !disabled && !draggingId && props.onPreview(p.id)}
            onPointerDown={(e) => onTilePointerDown(e, p.id)}
            onPointerMove={onTilePointerMove}
            onPointerUp={(e) => onTilePointerUp(e)}
            onPointerCancel={(e) => onTilePointerUp(e, true)}
            onFocus={(e) => {
              setFocusIndex(i);
              // Focus on the card's own buttons doesn't preview.
              if (e.target === e.currentTarget && !disabled && lastInputWasKeyboard()) props.onPreview(p.id);
            }}
            onClick={() => {
              if (dragged.current) {
                dragged.current = false;
                return;
              }
              props.onApply(p.id);
            }}
          >
            <span className="preset-thumb">
              <PresetIcon id={p.id} />
              {appliedId === p.id && <span className="preset-badge">Applied</span>}
              <button
                type="button"
                className="preset-action preset-tune"
                aria-expanded={tuningId === p.id}
                aria-label={`${p.name} settings`}
                data-tip="Feel and Fine-tune"
                {...keepToButton}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onTune(p.id);
                }}
              >
                <SlidersHorizontal size={14} aria-hidden="true" />
              </button>
              {props.trimNotes[p.id] && (
                <span className="preset-trim" role="img" aria-label={props.trimNotes[p.id]} data-tip={props.trimNotes[p.id]}>
                  <ExclamationMark />
                </span>
              )}
              {appliedId === p.id && (
                <button
                  type="button"
                  className="preset-action preset-remove"
                  aria-label={`Remove ${p.name}`}
                  data-tip="Remove transition"
                  data-keys="Delete"
                  {...keepToButton}
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onRemove();
                  }}
                >
                  <Trash size={14} aria-hidden="true" />
                </button>
              )}
            </span>
            <span className="preset-name">{p.name}</span>
            <span className="preset-hint">{p.hint}</span>
          </div>
        ))}
      </div>
      {/* Shown visually in the Transitions help popover; kept here for the listbox description. */}
      <p className="sr-only" id={hintId}>
        {helpText(draggable)}
      </p>
    </div>
  );
}
