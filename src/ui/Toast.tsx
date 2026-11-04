import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

/** How long a toast stays up when the pointer isn't over it. */
const TOAST_MS = 10000;

interface Props {
  text: string;
  /** Undoes the edit the toast describes. */
  onUndo: () => void;
  onClose: () => void;
}

/**
 * A visible note about a side effect of the last edit (e.g. clips trimmed to make
 * room), with Undo. The text is announced separately through the live region, so
 * the toast itself isn't live. Hovering keeps it up; it closes after a few seconds otherwise.
 */
export function Toast({ text, onUndo, onClose }: Props) {
  const timer = useRef(0);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const start = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => onCloseRef.current(), TOAST_MS);
  };
  const stop = () => window.clearTimeout(timer.current);

  // Restart the countdown for each new message.
  useEffect(() => {
    start();
    return stop;
  }, [text]);

  return (
    <div className="toast" role="group" aria-label="Notification" onPointerEnter={stop} onPointerLeave={start}>
      <span className="toast-text">{text}</span>
      <button type="button" className="toast-undo" onClick={onUndo}>
        Undo
      </button>
      <button type="button" className="toast-close" aria-label="Dismiss" onClick={onClose}>
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}
