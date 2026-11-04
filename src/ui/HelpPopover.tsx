import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Info } from 'lucide-react';

export interface HelpKey {
  readonly action: string;
  readonly keys: readonly string[];
}

interface Props {
  /** The explanation: one or more paragraphs. */
  children: ReactNode;
  /** Optional keyboard list under the explanation. */
  keys?: { readonly title: string; readonly items: readonly HelpKey[] };
}

/**
 * Info button in a sidebar panel's header that opens a small "how it works"
 * card. A click outside or Esc closes it.
 */
export function HelpPopover({ children, keys }: Props) {
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
          {children}
          {keys && (
            <>
              <h4 className="help-pop-group">{keys.title}</h4>
              <dl className="shortcut-list">
                {keys.items.map((k) => (
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
            </>
          )}
        </div>
      )}
    </div>
  );
}
