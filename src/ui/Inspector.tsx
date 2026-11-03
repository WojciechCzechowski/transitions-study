import { useId } from 'react';
import { getPreset } from '../config/transitions.config';
import { formatBezier, type Bezier } from '../model/easing';
import { feelToParams } from '../model/feel';
import { describeFeelClamp } from '../model/messages';
import type { Doc, Limits, Transition } from '../model/timeline';
import { formatDuration } from '../model/time';

interface Props {
  doc: Doc;
  transition: Transition;
  limits: Limits;
  looping: boolean;
  onFeelPointerDown: () => void;
  onFeelInput: (feel: number) => void;
  onChangePreset: () => void;
  onRemove: () => void;
  onToggleLoop: () => void;
}

/** Selected-transition controls: duration readout, the Feel slider and actions. */
export function Inspector({ doc, transition, limits, looping, ...on }: Props) {
  const preset = getPreset(transition.presetId);
  const params = feelToParams(transition.feel, preset.feel, limits);
  const feelId = useId();
  const clampNote =
    params.clamped === 'max' && transition.duration === params.duration
      ? describeFeelClamp(doc, limits, params.requested)
      : null;
  const manual = transition.duration !== params.duration;

  return (
    <section className="inspector" aria-label="Transition settings">
      <div className="inspector-col">
        <h2 className="inspector-title">{preset.name}</h2>
        <p className="muted">Centred on the cut</p>
        <dl className="readout">
          <dt>Duration</dt>
          <dd>
            {formatDuration(transition.duration)}
            <span className="muted"> · max {limits.max} f</span>
            {manual && <span className="muted"> · set by drag</span>}
          </dd>
        </dl>
      </div>

      <div className="inspector-col feel">
        <label htmlFor={feelId} className="feel-label">
          Feel <span className="muted">{transition.feel}</span>
        </label>
        <div className="feel-row">
          <span className="muted">Snappy</span>
          <input
            id={feelId}
            type="range"
            min={0}
            max={100}
            step={1}
            value={transition.feel}
            aria-valuetext={`${transition.feel} of 100, ${transition.feel < 34 ? 'snappy' : transition.feel > 66 ? 'smooth' : 'balanced'}`}
            onPointerDown={on.onFeelPointerDown}
            onChange={(e) => on.onFeelInput(Number(e.currentTarget.value))}
          />
          <span className="muted">Smooth</span>
        </div>
        <dl className="readout">
          <dt>Easing</dt>
          <dd className="easing">
            <EasingCurve bezier={params.bezier} />
            <code>{formatBezier(params.bezier)}</code>
          </dd>
          <dt>{preset.intensityLabel}</dt>
          <dd>{params.intensity.toFixed(2)}</dd>
        </dl>
        {clampNote && (
          <p className="notice" role="note">
            {clampNote}
          </p>
        )}
      </div>

      <div className="inspector-col actions">
        <button type="button" className="btn" aria-pressed={looping} onClick={on.onToggleLoop}>
          {looping ? 'Stop preview' : 'Preview loop'}
        </button>
        <button type="button" className="btn" onClick={on.onChangePreset}>
          Change preset…
        </button>
        <button type="button" className="btn btn-danger" onClick={on.onRemove} aria-keyshortcuts="Delete">
          Remove
        </button>
      </div>
    </section>
  );
}

function EasingCurve({ bezier }: { bezier: Bezier }) {
  const [x1, y1, x2, y2] = bezier;
  const W = 56;
  const H = 36;
  const P = 4;
  const sx = (x: number) => P + x * (W - 2 * P);
  const sy = (y: number) => H - P - y * (H - 2 * P);
  return (
    <svg className="easing-curve" viewBox={`0 0 ${W} ${H}`} aria-hidden="true" focusable="false">
      <rect x={P} y={P} width={W - 2 * P} height={H - 2 * P} className="easing-frame" />
      <path d={`M${sx(0)},${sy(0)} C${sx(x1)},${sy(y1)} ${sx(x2)},${sy(y2)} ${sx(1)},${sy(1)}`} className="easing-path" />
    </svg>
  );
}
