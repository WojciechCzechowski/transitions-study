import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Scissors } from 'lucide-react';
import type { Frames } from '../model/time';

interface Props {
  /** "a": the outgoing clip's end was trimmed (the pill sits left of the cut); "b": the incoming clip's start. */
  side: 'a' | 'b';
  /** Pixel x of the cut in the track. */
  cutX: number;
  trimmed: Frames;
  title: string;
  /** The clip's name, shown quietly after the title to match it to the Library. */
  name: string;
  body: string;
  fix: string;
}

/** Popover width, matching .trim-note-pop. */
const POP_W = 280;
/** Gap between the pill and the popover. */
const GAP = 6;
/** Space kept from the window edges. */
const MARGIN = 8;

/**
 * A small "✂ 28 f" pill beside a cut whose transition trimmed a clip to make room.
 * It stays as long as the trim does, so the reason the toast gave can be read again:
 * a click opens a card with the full why. A click outside or Esc closes it.
 */
export function TrimNote({ side, cutX, trimmed, title, name, body, fix }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<CSSProperties | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const popId = useId();
  const titleId = useId();

  // Hang below the pill, or above it when there's no room; kept inside the window.
  useLayoutEffect(() => {
    if (!open) return setPos(null);
    const b = buttonRef.current?.getBoundingClientRect();
    const h = popRef.current?.offsetHeight ?? 0;
    if (!b) return;
    const left = Math.max(MARGIN, Math.min(window.innerWidth - POP_W - MARGIN, b.left + b.width / 2 - POP_W / 2));
    const below = b.bottom + GAP + h <= window.innerHeight - MARGIN;
    setPos({ left, top: below ? b.bottom + GAP : Math.max(MARGIN, b.top - GAP - h) });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    popRef.current?.focus();
    // The pill toggles on its own click, so presses on it don't count as outside.
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
    // Placed once on open: scrolling the timeline or resizing would leave it behind, so close it.
    const onMove = (e: Event) => {
      if (e.target instanceof Node && popRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`trim-note trim-note-${side}${open ? ' open' : ''}`}
        style={{ left: cutX }}
        aria-label={`${trimmed} ${trimmed === 1 ? 'frame' : 'frames'} trimmed from the ${side === 'b' ? 'start of the right' : 'end of the left'} clip. Why?`}
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        data-tip={open ? undefined : `${trimmed} ${trimmed === 1 ? 'frame' : 'frames'} trimmed · why?`}
        // Keep the press from reaching the track, which would clear the selection.
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setOpen((o) => !o)}
      >
        <Scissors size={11} aria-hidden="true" />
        {trimmed} f
      </button>
      {open &&
        createPortal(
          <div
            ref={popRef}
            id={popId}
            className="trim-note-pop"
            role="dialog"
            aria-labelledby={titleId}
            tabIndex={-1}
            style={pos ?? { visibility: 'hidden', left: 0, top: 0 }}
          >
            <h3 id={titleId} className="help-pop-title">
              {title} <span className="trim-note-name">({name})</span>
            </h3>
            <p className="trim-note-body">{body}</p>
            <p className="trim-note-fix">{fix}</p>
          </div>,
          document.body,
        )}
    </>
  );
}
