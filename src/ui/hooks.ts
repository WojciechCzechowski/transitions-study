import { useCallback, useEffect, useRef, useState, type RefCallback } from 'react';

/** Apple platforms use ⌘ where others use Ctrl. */
export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const modKey = isMac ? '⌘' : 'Ctrl';

/** True when a key press should go to a text field rather than to app shortcuts. */
export function isTextEntry(el: HTMLElement | null): boolean {
  const tag = el?.tagName;
  return (
    (tag === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes((el as HTMLInputElement).type)) ||
    tag === 'TEXTAREA' ||
    !!el?.isContentEditable
  );
}

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** Live `prefers-reduced-motion` value. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof matchMedia === 'function' && matchMedia(REDUCED_MOTION).matches);
  useEffect(() => {
    const mq = matchMedia(REDUCED_MOTION);
    const onChange = () => setReduced(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

// --- input modality ---------------------------------------------------------
// Focus-driven previews should only start when focus came from the keyboard,
// so opening the gallery with a click doesn't start a preview before hover.

let lastInput: 'keyboard' | 'pointer' = 'pointer';
let installed = false;

export function installModalityTracking() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('keydown', () => (lastInput = 'keyboard'), true);
  window.addEventListener('pointerdown', () => (lastInput = 'pointer'), true);
}

export const lastInputWasKeyboard = () => lastInput === 'keyboard';

/** Width of an element, tracked with ResizeObserver. */
export function useElementWidth<T extends HTMLElement>(): [RefCallback<T>, number] {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setWidth(w);
    });
    ro.observe(el);
    observer.current = ro;
    setWidth(el.getBoundingClientRect().width);
  }, []);
  return [ref, width];
}

/** Content-box size of an element, tracked with ResizeObserver. */
export function useElementSize<T extends HTMLElement>(): [RefCallback<T>, { width: number; height: number }] {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    const update = (width: number, height: number) =>
      setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) update(box.width, box.height);
    });
    ro.observe(el);
    observer.current = ro;
    const rect = el.getBoundingClientRect();
    update(rect.width, rect.height);
  }, []);
  return [ref, size];
}

/** Polite live-region announcements; repeating the same text still re-announces. */
export function useAnnouncer() {
  const [message, setMessage] = useState({ text: '', n: 0 });
  const announce = useCallback((text: string) => setMessage((m) => ({ text, n: m.n + 1 })), []);
  return [message, announce] as const;
}
