import { useId, type ReactNode } from 'react';
import { GALLERY_KEYS } from './Gallery';
import { HelpPopover } from './HelpPopover';

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
        <HelpPopover keys={{ title: 'Keyboard, in the gallery', items: GALLERY_KEYS }}>
          <p className="help-pop-note">
            Click + between two clips to pick a cut, then click a preset to apply it.
            {canDragPresets && ' Or drag a preset straight onto any cut.'} Hovering a preset previews it at the cut,
            unless Preview on hover is off. Picking another preset for a transition keeps its Duration and Feel.
          </p>
        </HelpPopover>
      </header>
      <div className="tpanel-body">{children}</div>
    </section>
  );
}
