import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Clapperboard, Clock, FileText, Film } from 'lucide-react';
import type { Clip } from '../model/timeline';
import { formatClock, FPS, type Frames } from '../model/time';

/** Hover this long before the card shows. */
const SHOW_DELAY_MS = 200;
const GAP = 8;
const MARGIN = 6;

/**
 * Small badge in the top-left of the selected clip. Hovering it shows a card
 * with the clip's type, name, length and source frames. Visual only: the
 * clip's own aria-label already carries the same facts.
 */
export function ClipInfo({ clip, length }: { clip: Clip; length: Frames }) {
  const [open, setOpen] = useState(false);
  const badgeRef = useRef<HTMLSpanElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const timer = useRef(0);

  const show = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), SHOW_DELAY_MS);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setOpen(false);
  };

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Scrolling or pressing anywhere (a drag, a trim) puts the card away.
  useEffect(() => {
    if (!open) return;
    window.addEventListener('scroll', hide, true);
    window.addEventListener('pointerdown', hide, true);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('pointerdown', hide, true);
    };
  }, [open]);

  // Above the badge, left-aligned with it; below when there's no room above.
  useLayoutEffect(() => {
    const badge = badgeRef.current;
    const card = cardRef.current;
    if (!open || !badge || !card) return;
    const r = badge.getBoundingClientRect();
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    const left = Math.min(Math.max(MARGIN, r.left), window.innerWidth - w - MARGIN);
    const above = r.top - GAP - h;
    const top = above >= MARGIN ? above : r.bottom + GAP;
    card.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    card.style.visibility = 'visible';
  }, [open]);

  return (
    <>
      <span ref={badgeRef} className="clip-info" aria-hidden="true" onPointerEnter={show} onPointerLeave={hide}>
        <Clapperboard size={12} strokeWidth={2.25} />
      </span>
      {open &&
        createPortal(
          <div ref={cardRef} className="clip-info-card" aria-hidden="true" style={{ visibility: 'hidden' }}>
            <span className="clip-info-row">
              <Clapperboard size={14} />
              Video
            </span>
            <span className="clip-info-row">
              <FileText size={14} />
              {clip.label}
            </span>
            <span className="clip-info-row">
              <Clock size={14} />
              <span>
                {formatClock(length)}
                <span className="clip-info-dim">:{String(length % FPS).padStart(2, '0')}</span>
              </span>
            </span>
            <span className="clip-info-row">
              <Film size={14} />
              <span>
                Source frames {clip.sourceIn}–{clip.sourceOut - 1}
              </span>
            </span>
          </div>,
          document.body,
        )}
    </>
  );
}
