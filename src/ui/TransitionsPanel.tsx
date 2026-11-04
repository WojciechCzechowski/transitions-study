import { useId, type ReactNode } from 'react';

interface Props {
  /** Name of the selected transition's preset; picking another one swaps it. */
  presetName: string | null;
  /** Which cut the panel acts on, e.g. “Cut 2 · Clip A → Clip B”. Null when there are no cuts. */
  cutLabel: string | null;
  children: ReactNode;
}

/**
 * The Transitions tab: the preset gallery, acting on one cut. The selected
 * transition's adjustments live in the popover over it on the timeline.
 */
export function TransitionsPanel({ presetName, cutLabel, children }: Props) {
  const headingId = useId();

  return (
    <section className="tpanel" aria-labelledby={headingId} role="tabpanel">
      <header className="tpanel-head">
        <h2 id={headingId} className="tpanel-title">
          Transitions
        </h2>
      </header>
      {cutLabel && <p className="tpanel-cut">{cutLabel}</p>}
      {presetName && <p className="tpanel-sub">Pick a preset to replace {presetName}. Duration and Feel are kept.</p>}
      <div className="tpanel-body">{children}</div>
    </section>
  );
}
