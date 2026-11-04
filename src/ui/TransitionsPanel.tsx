import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { GALLERY_KEYS } from './Gallery';

interface Props {
  /** Presets can be dragged onto cuts right now; the help mentions it. */
  canDragPresets: boolean;
  /** Which cut the panel acts on, e.g. “Cut 2 · Clip A → Clip B”. Null when there are no cuts. */
  cutLabel: string | null;
  children: ReactNode;
}

/**
 * The Transitions tab: the preset gallery, acting on one cut. The selected
 * transition's adjustments live in the popover over it on the timeline.
 */
export function TransitionsPanel({ canDragPresets, cutLabel, children }: Props) {
  const headingId = useId();

  return (
    <section className="tpanel" aria-labelledby={headingId} role="tabpanel">
      <header className="tpanel-head">
        {/* The cut sits beside the title, so picking one doesn't push the gallery down. */}
        <div className="tpanel-heading">
          <h2 id={headingId} className="tpanel-title">
            Transitions
          </h2>
          {cutLabel && (
            <span className="tpanel-cut" title={cutLabel}>
              {cutLabel}
            </span>
          )}
        </div>
        <HelpPopover canDragPresets={canDragPresets} />
      </header>
      <div className="tpanel-body">{children}</div>
    </section>
  );
}

/** Info button that opens a small "how it works" card. A click outside or Esc closes it. */
function HelpPopover({ canDragPresets }: { canDragPresets: boolean }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const popId = useId();
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    popRef.current?.focus();
    // The button toggles on its own click, so presses on it don't count as outside.
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || buttonRef.current?.contains(t)) return;
      setOpen(false);
    };
    // Capture, so Esc closes this first instead of also clearing the editor's selection.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div className="help">
      <button
        ref={buttonRef}
        type="button"
        className={`btn-icon help-button${open ? ' open' : ''}`}
        aria-label="How it works"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        data-tip={open ? undefined : 'How it works'}
        onClick={() => setOpen((o) => !o)}
      >
        <Info size={16} aria-hidden="true" />
      </button>
      {open && (
        <div ref={popRef} id={popId} className="help-pop" role="dialog" aria-labelledby={titleId} tabIndex={-1}>
          <h3 id={titleId} className="help-pop-title">
            How it works
          </h3>
          <p className="help-pop-note">
            Click + between two clips to pick a cut, then click a preset to apply it.
            {canDragPresets && ' Or drag a preset straight onto any cut.'} Hovering a preset previews it at the cut,
            unless Preview on hover is off. Picking another preset for a transition keeps its Duration and Feel.
          </p>
          <h4 className="help-pop-group">Keyboard, in the gallery</h4>
          <dl className="shortcut-list">
            {GALLERY_KEYS.map((k) => (
              <div key={k.action} className="shortcut-row">
                <dt>{k.action}</dt>
                <dd>
                  <span className="keys">
                    {k.keys.map((key) => (
                      <kbd key={key}>{key}</kbd>
                    ))}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
