import type { Ref } from 'react';
import type { Cut } from '../model/timeline';

interface Props {
  cut: Cut;
  left: number;
  ready: boolean;
  /** This cut is the Transitions picker's target and the picker is in use. */
  engaged: boolean;
  pickerId: string;
  buttonRef?: Ref<HTMLButtonElement>;
  onHover: (hover: boolean) => void;
  onFocusChange: (focused: boolean) => void;
  onChoose: () => void;
}

/** The + that appears on a cut without a transition. */
export function CutZone({ cut, left, ready, engaged, pickerId, buttonRef, onHover, onFocusChange, onChoose }: Props) {
  return (
    <div
      className={`cut-zone${engaged ? ' engaged' : ''}`}
      style={{ left }}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
    >
      <button
        ref={buttonRef}
        type="button"
        className="cut-handle"
        aria-label={`Choose a transition for the cut between ${cut.from.label} and ${cut.to.label}${ready ? '' : ' (preparing frames)'}`}
        aria-controls={pickerId}
        aria-disabled={!ready || undefined}
        data-tip={ready ? 'Add transition' : 'Preparing frames'}
        onFocus={() => onFocusChange(true)}
        onBlur={() => onFocusChange(false)}
        onClick={() => ready && onChoose()}
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}
