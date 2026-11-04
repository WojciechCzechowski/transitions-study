import { useId, type ReactNode, type Ref } from 'react';
import type { SidebarView } from '../model/layout';

interface Props {
  view: SidebarView;
  /** Name of the applied preset, if any. */
  presetName: string | null;
  /** Level 1 opened from level 2 to swap the applied preset. */
  changing: boolean;
  /** Which cut the panel acts on, e.g. “Cut 2 · Clip A → Clip B”. Null when there are no cuts. */
  cutLabel: string | null;
  /** Level-2 heading; focused after a preset is applied. */
  editHeadingRef: Ref<HTMLHeadingElement>;
  /** From level 2: back to level 1 to swap the preset. */
  onChange: () => void;
  /** While swapping: back to level 2 without changing anything. */
  onBack: () => void;
  children: ReactNode;
}

/**
 * The Transitions tab, acting on one cut. Level 1 is “Transitions” (pick /
 * apply / swap); level 2 is “Transitions / ‹Preset›” (edit the selected transition).
 */
export function TransitionsPanel({ view, presetName, changing, cutLabel, editHeadingRef, onChange, onBack, children }: Props) {
  const headingId = useId();

  return (
    <section className="tpanel" aria-labelledby={headingId} role="tabpanel">
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
      {cutLabel && <p className="tpanel-cut">{cutLabel}</p>}
      {view === 'pick' && changing && presetName && (
        <p className="tpanel-sub">Pick a preset to replace {presetName}. Duration and Feel are kept.</p>
      )}
      <div className="tpanel-body">{children}</div>
    </section>
  );
}
