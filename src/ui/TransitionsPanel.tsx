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
 * The Transitions tab: the preset gallery, acting on one cut. Each card's settings
 * button opens Feel and Fine-tune for it: the applied transition's, or a draft
 * the next apply uses.
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
            unless Preview on hover is off. The settings button on a card sets its Feel and Fine-tune, previewed at the
            cut, before or after applying it. Picking another preset for a transition keeps its Duration, and keeps
            its Feel unless that preset has settings of its own.
          </p>
        </HelpPopover>
      </header>
      <div className="tpanel-body">{children}</div>
    </section>
  );
}
