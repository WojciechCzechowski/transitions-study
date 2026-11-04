import { useEffect, useId, useLayoutEffect, useRef, type CSSProperties, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { Play, SlidersHorizontal, Square, Trash } from 'lucide-react';
import { EASING_CURVES, getPreset } from '../config/transitions.config';
import type { Bezier } from '../model/easing';
import { INTENSITY_MAX, INTENSITY_MIN, isTuned, tuningParams } from '../model/feel';
import type { Transition } from '../model/timeline';
import { formatDuration } from '../model/time';

interface Props {
  transition: Transition;
  /** The transition's body on the timeline; the popover centres on it and sits above the clips. */
  anchor: () => HTMLElement | null;
  looping: boolean;
  /** Heading, focused after a preset is applied. */
  headingRef: Ref<HTMLHeadingElement>;
  fineTuneOpen: boolean;
  onFineTuneToggle: () => void;
  /** A slider drag starts; the drag becomes one undo step with this label. */
  onSliderPointerDown: (label: string) => void;
  onFeelInput: (feel: number) => void;
  onIntensityInput: (intensity: number) => void;
  onEasingPick: (bezier: Bezier) => void;
  /** Drop the Fine-tune overrides, back to what Feel gives. */
  onResetTuning: () => void;
  onRemove: () => void;
  onToggleLoop: () => void;
}

/** Gap between the popover's box and the top of the clips; the 6px arrow sits in it. */
const GAP = 10;
/** Space kept from the window edges. */
const MARGIN = 8;

/** Adjustments for the selected transition, floating over its midpoint. */
export function TransitionPopover({ transition: t, anchor, looping, headingRef, fineTuneOpen, ...on }: Props) {
  const preset = getPreset(t.presetId);
  const params = tuningParams(t, preset.feel);
  const custom = isTuned(t);
  const headingId = useId();
  const feelId = useId();
  const tuneId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const tuneBtnRef = useRef<HTMLButtonElement>(null);
  const tunePopRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  const toggleTuneRef = useRef(on.onFineTuneToggle);
  toggleTuneRef.current = on.onFineTuneToggle;

  // A press anywhere outside Fine-tune closes it. Its own button is left to toggle it.
  useEffect(() => {
    if (!fineTuneOpen) return;
    const onDown = (e: PointerEvent) => {
      const el = e.target as Node | null;
      if (!el || tunePopRef.current?.contains(el) || tuneBtnRef.current?.contains(el)) return;
      toggleTuneRef.current();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [fineTuneOpen]);

  // Follow the anchor through scrolling, zooming and pane resizes.
  useLayoutEffect(() => {
    let raf = 0;
    let last = '';
    const place = () => {
      const box = boxRef.current;
      const el = anchorRef.current();
      if (box) {
        const pos = el ? measure(el, box) : null;
        const key = pos ? `${pos.left},${pos.top},${pos.arrow}` : 'hidden';
        if (key !== last) {
          last = key;
          box.style.visibility = pos ? 'visible' : 'hidden';
          if (pos) {
            box.style.left = `${pos.left}px`;
            box.style.top = `${pos.top}px`;
            box.style.setProperty('--arrow-x', `${pos.arrow}px`);
          }
        }
      }
      raf = requestAnimationFrame(place);
    };
    place();
    return () => cancelAnimationFrame(raf);
  }, []);

  const closeTune = () => {
    on.onFineTuneToggle();
    tuneBtnRef.current?.focus();
  };

  return createPortal(
    <div
      ref={boxRef}
      className="tpopover"
      role="dialog"
      aria-labelledby={headingId}
      style={{ visibility: 'hidden' }}
      onKeyDown={(e) => {
        // Escape closes Fine-tune first; the next one deselects as before.
        if (e.key === 'Escape' && fineTuneOpen) {
          e.stopPropagation();
          closeTune();
        }
      }}
    >
      <h2 ref={headingRef} id={headingId} className="tpopover-head" tabIndex={-1}>
        {preset.name} <span className="muted">· {formatDuration(t.duration)}</span>
      </h2>

      <div className="tpopover-feel">
        <div className="feel-head">
          <label htmlFor={feelId} className="feel-label">
            Feel
          </label>
          {custom && (
            <span className="feel-note" id={`${feelId}-note`}>
              Fine-tune applied ·{' '}
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  on.onResetTuning();
                  // This link goes away; land on the slider it just re-enabled.
                  requestAnimationFrame(() => document.getElementById(feelId)?.focus());
                }}
              >
                Reset
              </button>
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
          value={t.feel}
          valueText={feelWord(t.feel)}
          onPointerDown={() => on.onSliderPointerDown('Change feel')}
          onChange={on.onFeelInput}
        />
      </div>

      <div className="tpopover-actions">
        <div className="tpopover-actions-start">
          {/* Play first: watching the transition is the main action; Fine-tune is optional. */}
          <button
            type="button"
            className="btn-icon"
            onClick={on.onToggleLoop}
            aria-label={looping ? 'Stop preview' : 'Play preview'}
            data-tip={looping ? 'Stop preview' : 'Play preview'}
            data-keys={looping ? 'Esc' : undefined}
          >
            {looping ? <Square size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
          </button>
          <button
            ref={tuneBtnRef}
            type="button"
            className="btn-icon"
            aria-expanded={fineTuneOpen}
            aria-controls={fineTuneOpen ? tuneId : undefined}
            onClick={on.onFineTuneToggle}
            aria-label="Fine-tune"
            data-tip="Fine-tune"
          >
            <SlidersHorizontal size={16} aria-hidden="true" />
          </button>
          {fineTuneOpen && (
            <div ref={tunePopRef} id={tuneId} className="tune-pop" role="group" aria-label="Fine-tune">
              <div className="tune-head">
                <span className="tune-title">Fine-tune</span>
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => custom && on.onResetTuning()}
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
              />
            </div>
          )}
        </div>
        <button
          type="button"
          className="btn-icon btn-danger"
          onClick={on.onRemove}
          aria-label="Remove transition"
          data-tip="Remove transition"
          data-keys="Delete"
          aria-keyshortcuts="Delete"
        >
          <Trash size={16} aria-hidden="true" />
        </button>
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
}

/** A filled track with its labels inside, over an invisible native range input. */
function TrackSlider({ id, label, describedBy, disabled, start, end, endIsValue, min, max, step, value, valueText, onPointerDown, onChange }: TrackSliderProps) {
  const t = max > min ? (value - min) / (max - min) : 0;
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

/** Where the popover goes for an anchor, or null when the anchor is scrolled out of view. */
function measure(el: HTMLElement, box: HTMLElement): { left: number; top: number; arrow: number } | null {
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const clip = el.closest('.track')?.querySelector('.clip');
  const clipTop = clip ? clip.getBoundingClientRect().top : r.top;
  const viewport = el.closest('.timeline-scroll')?.getBoundingClientRect();
  const pane = el.closest('.timeline')?.getBoundingClientRect();
  if (viewport && (x < viewport.left || x > viewport.right)) return null;
  if (pane && (clipTop < pane.top || clipTop > pane.bottom)) return null;
  const w = box.offsetWidth;
  const h = box.offsetHeight;
  const left = Math.round(Math.min(Math.max(x - w / 2, MARGIN), window.innerWidth - w - MARGIN));
  const top = Math.round(Math.max(MARGIN, clipTop - GAP - h));
  return { left, top, arrow: Math.round(x - left) };
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
