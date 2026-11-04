import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { stepSize, type Range } from '../model/layout';

interface Props {
  /** `vertical` sits between columns (drag left/right); `horizontal` between rows. */
  orientation: 'vertical' | 'horizontal';
  label: string;
  value: number;
  range: Range;
  defaultValue: number;
  /**
   * Pointer movement that grows the pane: +1 when moving right/down grows it,
   * −1 when moving left/up does (a pane below or right of the splitter).
   */
  direction: 1 | -1;
  onChange: (value: number) => void;
}

/**
 * Window-splitter separator. Drag with the pointer, step with the arrow keys
 * (Shift for bigger steps), Home/End for the limits, double-click to reset.
 */
export function Splitter({ orientation, label, value, range, defaultValue, direction, onChange }: Props) {
  const drag = useRef<{ pointerId: number; start: number; startValue: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const vertical = orientation === 'vertical';
  const coord = (e: PointerEvent) => (vertical ? e.clientX : e.clientY);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus({ preventScroll: true });
    drag.current = { pointerId: e.pointerId, start: coord(e), startValue: value };
    setDragging(true);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    onChange(d.startValue + direction * (coord(e) - d.start));
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Vertical splitter: → grows a left pane. Horizontal: ↑ grows a pane below.
    const grow = vertical ? (direction === 1 ? 'ArrowRight' : null) : direction === -1 ? 'ArrowUp' : null;
    if (!grow) return;
    const next = stepSize(e.key, e.shiftKey, value, range, grow);
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    onChange(next);
  };

  return (
    <div
      className={`splitter splitter-${orientation}${dragging ? ' dragging' : ''}`}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={orientation}
      aria-valuenow={Math.round(value)}
      aria-valuemin={range.min}
      aria-valuemax={range.max}
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onLostPointerCapture={onPointerUp}
      onDoubleClick={() => onChange(defaultValue)}
      onKeyDown={onKeyDown}
    />
  );
}
