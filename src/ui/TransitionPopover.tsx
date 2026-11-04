import { useEffect, useId, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { EASING_CURVES, getPreset } from '../config/transitions.config';
import type { Bezier } from '../model/easing';
import { INTENSITY_MAX, INTENSITY_MIN, isTuned, tuningParams, type Tuning } from '../model/feel';
import { formatDuration, FPS, type Frames } from '../model/time';

interface Props {
  presetId: string;
  /** Feel and Fine-tune values shown: the applied transition's, or the draft for the next apply. */
  tuning: Tuning;
  duration: Frames;
  /** What the clips at the cut allow; null (slider disabled) when there's no cut to measure. */
  durationRange: { readonly min: Frames; readonly max: Frames } | null;
  /** Edits change the transition on the timeline (true) or a draft used when it's applied. */
  live: boolean;
  /** Shown under the heading, e.g. why the preview can't play. */
  note: string | null;
  /** The preset card's thumbnail; the popover hangs below it (or above, if there's no room). */
  anchor: () => HTMLElement | null;
  /** The button that opened it: presses on it toggle instead of counting as outside. */
  opener: () => HTMLElement | null;
  onClose: () => void;
  /** A slider drag starts; on a live transition the drag becomes one undo step with this label. */
  onSliderPointerDown: (label: string) => void;
  onDurationInput: (duration: Frames) => void;
  onFeelInput: (feel: number) => void;
  onIntensityInput: (intensity: number) => void;
  onEasingPick: (bezier: Bezier) => void;
  /** Drop the Fine-tune overrides, back to what Feel gives. */
  onResetTuning: () => void;
  /** Double-click on a slider's handle: back to its default. */
  onDurationReset: () => void;
  onFeelReset: () => void;
  onIntensityReset: () => void;
}

/** Gap between the thumbnail and the popover; the arrow sits in it. */
const GAP = 10;
/** Space kept from the window edges. */
const MARGIN = 8;

/** Feel and Fine-tune for one preset, all visible at once, opened from its card. */
export function TransitionPopover({ presetId, tuning, duration, durationRange, live, note, anchor, opener, onClose, ...on }: Props) {
  const preset = getPreset(presetId);
  const params = tuningParams(tuning, preset.feel);
  const custom = isTuned(tuning);
  const headingId = useId();
  const feelId = useId();
  const tuneId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  const openerRef = useRef(opener);
  openerRef.current = opener;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // A press anywhere outside closes it. Its own button is left to toggle it.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const el = e.target as Node | null;
      if (!el || boxRef.current?.contains(el) || openerRef.current()?.contains(el)) return;
      closeRef.current();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, []);

  // Follow the card through scrolling and pane resizes.
  useLayoutEffect(() => {
    let raf = 0;
    let last = '';
    const place = () => {
      const box = boxRef.current;
      const el = anchorRef.current();
      if (box) {
        const pos = el ? measure(el, box) : null;
        const key = pos ? `${pos.left},${pos.top},${pos.arrow},${pos.below}` : 'hidden';
        if (key !== last) {
          last = key;
          box.style.visibility = pos ? 'visible' : 'hidden';
          if (pos) {
            box.style.left = `${pos.left}px`;
            box.style.top = `${pos.top}px`;
            box.style.setProperty('--arrow-x', `${pos.arrow}px`);
            box.classList.toggle('below', pos.below);
          }
        }
      }
      raf = requestAnimationFrame(place);
    };
    place();
    return () => cancelAnimationFrame(raf);
  }, []);

  return createPortal(
    <div
      ref={boxRef}
      className="tpopover"
      role="dialog"
      aria-labelledby={headingId}
      style={{ visibility: 'hidden' }}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        onClose();
        openerRef.current()?.focus();
      }}
    >
      <h2 id={headingId} className="tpopover-head">
        {preset.name} <span className="muted">· {formatDuration(duration)}</span>
      </h2>
      {(note || !live) && <p className="tpopover-note">{note ?? 'Not applied yet. Applying uses these settings.'}</p>}

      {/* The timeline edges change it too; this is the same value. */}
      <TrackSlider
        label="Duration"
        start="Duration"
        end={`${duration} f · ${(duration / FPS).toFixed(2)} s`}
        endIsValue
        disabled={!durationRange}
        min={durationRange?.min ?? duration}
        max={durationRange?.max ?? duration}
        step={2}
        value={duration}
        valueText={`${duration} frames, ${(duration / FPS).toFixed(2)} seconds`}
        onPointerDown={() => on.onSliderPointerDown('Change duration')}
        onChange={on.onDurationInput}
        onReset={on.onDurationReset}
      />

      <div className="tpopover-feel">
        <div className="feel-head">
          <label htmlFor={feelId} className="feel-label">
            Feel
          </label>
          {custom && (
            <span className="feel-note" id={`${feelId}-note`}>
              Fine-tune applied
            </span>
          )}
        </div>
        <TrackSlider
          id={feelId}
          describedBy={custom ? `${feelId}-note` : undefined}
          disabled={custom}
          start="Snappy"
          end="Smooth"
          min={0}
          max={100}
          step={1}
          value={tuning.feel}
          valueText={feelWord(tuning.feel)}
          onPointerDown={() => on.onSliderPointerDown('Change feel')}
          onChange={on.onFeelInput}
          onReset={on.onFeelReset}
        />
      </div>

      <div className="tune-section" role="group" aria-labelledby={`${tuneId}-title`}>
        <div className="tune-head">
          <span className="tune-title" id={`${tuneId}-title`}>
            Fine-tune
          </span>
          <button
            type="button"
            className="btn btn-small"
            onClick={() => {
              if (!custom) return;
              on.onResetTuning();
              // Land on the slider it just re-enabled.
              requestAnimationFrame(() => document.getElementById(feelId)?.focus());
            }}
            aria-disabled={!custom}
            title="Go back to the curve and intensity Feel gives"
          >
            Reset
          </button>
        </div>
        <div className="tune-row">
          <span className="tune-label" id={`${tuneId}-easing`}>
            Easing
          </span>
          <div className="curves" role="group" aria-labelledby={`${tuneId}-easing`}>
            {EASING_CURVES.map((c) => {
              const picked = sameCurve(c.bezier, params.bezier);
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={picked}
                  className={`curve${picked ? ' on' : ''}`}
                  aria-label={c.name}
                  data-tip={c.name}
                  onClick={() => on.onEasingPick(c.bezier)}
                >
                  <CurveGlyph bezier={c.bezier} />
                </button>
              );
            })}
          </div>
        </div>
        <TrackSlider
          label={preset.intensityLabel}
          start={preset.intensityLabel}
          end={params.intensity.toFixed(2)}
          endIsValue
          min={INTENSITY_MIN}
          max={INTENSITY_MAX}
          step={0.01}
          value={params.intensity}
          onPointerDown={() => on.onSliderPointerDown('Change intensity')}
          onChange={on.onIntensityInput}
          onReset={on.onIntensityReset}
        />
      </div>
    </div>,
    document.body,
  );
}

interface TrackSliderProps {
  /** For a visible <label htmlFor>; without one, `label` names the input. */
  id?: string;
  /** Accessible name when there is no visible label. */
  label?: string;
  /** Id of text explaining the slider's state, e.g. why it is disabled. */
  describedBy?: string;
  disabled?: boolean;
  /** Text inside the track at the left and right ends. */
  start: string;
  end: string;
  /** `end` is the live value: drawn darker, in tabular figures. */
  endIsValue?: boolean;
  min: number;
  max: number;
  step: number;
  value: number;
  valueText?: string;
  onPointerDown: () => void;
  onChange: (value: number) => void;
  /** Double-click on the handle. */
  onReset?: () => void;
}

/** How close (px) to the drawn handle a double-click must land to reset. */
const HANDLE_HIT = 10;

/** A filled track with its labels inside, over an invisible native range input. */
function TrackSlider({ id, label, describedBy, disabled, start, end, endIsValue, min, max, step, value, valueText, onPointerDown, onChange, onReset }: TrackSliderProps) {
  const t = max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0;
  return (
    <div className="track-slider" style={{ '--t': Math.min(1, Math.max(0, t)) } as CSSProperties}>
      <span className="track-fill" aria-hidden="true" />
      <span className="track-end" aria-hidden="true">
        {start}
      </span>
      <span className={`track-end${endIsValue ? ' track-value' : ''}`} aria-hidden="true">
        {end}
      </span>
      <span className="track-handle" aria-hidden="true" />
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        aria-describedby={describedBy}
        aria-valuetext={valueText}
        disabled={disabled}
        onPointerDown={onPointerDown}
        onDoubleClick={(e) => {
          if (!onReset || disabled) return;
          // Only on the handle: pressing it doesn't move the value, so the two clicks change nothing first.
          const r = e.currentTarget.getBoundingClientRect();
          const h = parseFloat(getComputedStyle(e.currentTarget.parentElement!).getPropertyValue('--h')) || 16;
          const handleX = r.left + h / 2 + (r.width - h) * t;
          if (Math.abs(e.clientX - handleX) <= HANDLE_HIT) onReset();
        }}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
      />
    </div>
  );
}

/** Feel in words for screen readers; the number on its own means nothing. */
function feelWord(feel: number): string {
  if (feel <= 10) return 'Snappy';
  if (feel <= 40) return 'Slightly snappy';
  if (feel < 60) return 'Balanced';
  if (feel < 90) return 'Slightly smooth';
  return 'Smooth';
}

/** Where the popover goes: below the thumbnail, or above it when the window has no room. */
function measure(el: HTMLElement, box: HTMLElement): { left: number; top: number; arrow: number; below: boolean } | null {
  const r = el.getBoundingClientRect();
  const scroller = el.closest('.tpanel-body')?.getBoundingClientRect();
  if (scroller && (r.bottom < scroller.top || r.top > scroller.bottom)) return null;
  const x = r.left + r.width / 2;
  const w = box.offsetWidth;
  const h = box.offsetHeight;
  const below = r.bottom + GAP + h + MARGIN <= window.innerHeight || r.top - GAP - h < MARGIN;
  const left = Math.round(Math.min(Math.max(x - w / 2, MARGIN), window.innerWidth - w - MARGIN));
  const top = Math.round(below ? r.bottom + GAP : r.top - GAP - h);
  return { left, top, arrow: Math.round(x - left), below };
}

/** Feel blends between curves, so only a near-exact match counts as picked. */
const sameCurve = (a: Bezier, b: Bezier) => a.every((v, i) => Math.abs(v - b[i]!) < 0.005);

function CurveGlyph({ bezier }: { bezier: Bezier }) {
  const [x1, y1, x2, y2] = bezier;
  const S = 24;
  const P = 3;
  const sx = (x: number) => P + x * (S - 2 * P);
  const sy = (y: number) => S - P - y * (S - 2 * P);
  return (
    <svg viewBox={`0 0 ${S} ${S}`} width={S} height={S} aria-hidden="true" focusable="false">
      <path d={`M${sx(0)},${sy(0)} C${sx(x1)},${sy(y1)} ${sx(x2)},${sy(y2)} ${sx(1)},${sy(1)}`} />
    </svg>
  );
}
