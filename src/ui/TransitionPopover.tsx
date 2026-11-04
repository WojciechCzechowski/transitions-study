import { useId, useLayoutEffect, useRef, type Ref } from 'react';
import { createPortal } from 'react-dom';
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
  const feelId = useId();
  const headingId = useId();
  const tuneId = useId();
  const intensityId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;

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

  return createPortal(
    <div ref={boxRef} className="tpopover" role="dialog" aria-labelledby={headingId} style={{ visibility: 'hidden' }}>
      <h2 ref={headingRef} id={headingId} className="tpopover-head" tabIndex={-1}>
        {preset.name} <span className="muted">· {formatDuration(t.duration)}</span>
      </h2>

      <div className="tpopover-feel">
        <div className="feel-head">
          <label htmlFor={feelId} className="feel-label">
            Feel <span className="muted">{custom ? 'Custom' : t.feel}</span>
          </label>
          {custom && (
            <button type="button" className="link-btn" onClick={on.onResetTuning} title="Use the curve and intensity Feel gives">
              Reset
            </button>
          )}
        </div>
        <div className="feel-row">
          <span className="muted">Snappy</span>
          <input
            id={feelId}
            type="range"
            min={0}
            max={100}
            step={1}
            value={t.feel}
            aria-valuetext={`${t.feel} of 100, ${t.feel < 34 ? 'snappy' : t.feel > 66 ? 'smooth' : 'balanced'}`}
            onPointerDown={() => on.onSliderPointerDown('Change feel')}
            onChange={(e) => on.onFeelInput(Number(e.currentTarget.value))}
          />
          <span className="muted">Smooth</span>
        </div>
      </div>

      <div className="tune">
        <button type="button" className="tune-toggle" aria-expanded={fineTuneOpen} aria-controls={tuneId} onClick={on.onFineTuneToggle}>
          <span className="tune-chevron" aria-hidden="true" />
          Fine-tune
        </button>
        {fineTuneOpen && (
          <div id={tuneId} className="tune-body">
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
                      title={c.name}
                      aria-label={c.name}
                      onClick={() => on.onEasingPick(c.bezier)}
                    >
                      <CurveGlyph bezier={c.bezier} />
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="tune-row">
              <label className="tune-label" htmlFor={intensityId}>
                {preset.intensityLabel}
              </label>
              <div className="feel-row">
                <input
                  id={intensityId}
                  type="range"
                  min={INTENSITY_MIN}
                  max={INTENSITY_MAX}
                  step={0.01}
                  value={params.intensity}
                  onPointerDown={() => on.onSliderPointerDown('Change intensity')}
                  onChange={(e) => on.onIntensityInput(Number(e.currentTarget.value))}
                />
                <span className="tune-value">{params.intensity.toFixed(2)}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="tpopover-actions">
        <button type="button" className="btn btn-small" aria-pressed={looping} onClick={on.onToggleLoop}>
          {looping ? 'Stop preview' : 'Preview loop'}
        </button>
        <button type="button" className="btn btn-small btn-danger" onClick={on.onRemove} aria-keyshortcuts="Delete">
          Remove
        </button>
      </div>
    </div>,
    document.body,
  );
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
