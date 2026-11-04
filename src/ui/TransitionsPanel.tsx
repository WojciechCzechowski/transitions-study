import { useId, type ReactNode, type Ref } from 'react';
import type { SidebarView } from '../model/layout';

interface Props {
  view: SidebarView;
  /** Name of the applied preset, if any. */
  presetName: string | null;
  /** Level 1 opened from level 2 to swap the applied preset. */
  changing: boolean;
  /** Level-2 heading; focused after a preset is applied. */
  editHeadingRef: Ref<HTMLHeadingElement>;
  /** From level 2: back to level 1 to swap the preset. */
  onChange: () => void;
  /** While swapping: back to level 2 without changing anything. */
  onBack: () => void;
  footer: ReactNode;
  children: ReactNode;
}

/**
 * The sidebar's single tab. Level 1 is “Transitions” (pick / apply / swap);
 * level 2 is “Transitions / ‹Preset›” (edit the selected transition).
 */
export function TransitionsPanel({ view, presetName, changing, editHeadingRef, onChange, onBack, footer, children }: Props) {
  const headingId = useId();

  return (
    <section className="tpanel" aria-labelledby={headingId}>
      <header className="tpanel-head">
        {view === 'edit' && presetName ? (
          <nav className="crumbs" aria-label="Transitions">
            <button type="button" className="crumb-link" onClick={onChange} title="Back to presets to change the transition">
              Transitions
            </button>
            <span className="crumb-sep" aria-hidden="true">
              /
            </span>
            <h2 ref={editHeadingRef} id={headingId} className="crumb-current" tabIndex={-1}>
              {presetName}
            </h2>
          </nav>
        ) : (
          <>
            <h2 id={headingId} className="tpanel-title">
              Transitions
            </h2>
            {changing && (
              <button type="button" className="btn btn-small" onClick={onBack} aria-keyshortcuts="Escape">
                Back
              </button>
            )}
          </>
        )}
      </header>
      {view === 'pick' && changing && presetName && (
        <p className="tpanel-sub">Pick a preset to replace {presetName}. Duration and Feel are kept.</p>
      )}
      <div className="tpanel-body">{children}</div>
      <footer className="tpanel-foot">{footer}</footer>
    </section>
  );
}
