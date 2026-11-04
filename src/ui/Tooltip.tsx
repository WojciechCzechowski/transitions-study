import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * One tooltip for the whole app. Any element with `data-tip` gets it on hover
 * (after a short delay) or on keyboard focus. `data-keys` adds a keyboard
 * shortcut as keycaps, space-separated: "⇧ ⌘ Z". The tooltip is visual only;
 * the element's aria-label (and aria-keyshortcuts) carry the same for assistive tech.
 */

/** Hover this long before the first tooltip shows. */
const SHOW_DELAY_MS = 450;
/** Moving to another tipped element within this long shows its tooltip at once. */
const WARM_MS = 400;
/** Gap between the tooltip and its element. */
const GAP = 6;
/** Space kept from the window edges. */
const MARGIN = 6;

interface Tip {
  el: HTMLElement;
  text: string;
  keys: string[];
}

const tipOf = (el: HTMLElement): Tip | null => {
  const text = el.dataset.tip;
  if (!text) return null;
  const keys = el.dataset.keys?.split(' ').filter(Boolean) ?? [];
  return { el, text, keys };
};

const tippedFrom = (target: EventTarget | null): HTMLElement | null =>
  target instanceof Element ? target.closest<HTMLElement>('[data-tip]') : null;

export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer = 0;
    let hiddenAt = -Infinity;
    let current: HTMLElement | null = null;

    const show = (el: HTMLElement, immediate: boolean) => {
      window.clearTimeout(timer);
      current = el;
      const go = () => setTip(tipOf(el));
      if (immediate || performance.now() - hiddenAt < WARM_MS) go();
      else timer = window.setTimeout(go, SHOW_DELAY_MS);
    };
    const hide = () => {
      window.clearTimeout(timer);
      if (current) hiddenAt = performance.now();
      current = null;
      setTip(null);
    };

    const onOver = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const el = tippedFrom(e.target);
      if (el === current) return;
      if (el) show(el, false);
      else if (current && !current.matches(':focus-visible')) hide();
    };
    const onFocusIn = (e: FocusEvent) => {
      const el = tippedFrom(e.target);
      if (el && el.matches(':focus-visible')) show(el, true);
      else if (current) hide();
    };
    const onFocusOut = (e: FocusEvent) => {
      if (current && e.target === current) hide();
    };
    // Leaving the window: pointerover won't fire again until the pointer is back.
    const onOut = (e: PointerEvent) => {
      if (!e.relatedTarget && current && !current.matches(':focus-visible')) hide();
    };
    // A press acts on the element; the tooltip has done its job.
    const onDown = () => current && hide();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && current) hide();
    };

    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerout', onOut);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerout', onOut);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  // Follow the element while shown: its label or keys can change (Undo's label does),
  // and it can move or be removed.
  useLayoutEffect(() => {
    if (!tip) return;
    let raf = 0;
    const place = () => {
      const box = boxRef.current;
      const { el } = tip;
      if (!el.isConnected) {
        setTip(null);
        return;
      }
      const next = tipOf(el);
      if (!next) {
        setTip(null);
        return;
      }
      if (next.text !== tip.text || next.keys.join(' ') !== tip.keys.join(' ')) {
        setTip(next);
        return;
      }
      if (box) {
        const r = el.getBoundingClientRect();
        const w = box.offsetWidth;
        const h = box.offsetHeight;
        const left = Math.min(Math.max(MARGIN, r.left + r.width / 2 - w / 2), window.innerWidth - w - MARGIN);
        const above = r.top - GAP - h;
        const top = above >= MARGIN ? above : r.bottom + GAP;
        box.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
        box.style.visibility = 'visible';
      }
      raf = requestAnimationFrame(place);
    };
    place();
    return () => cancelAnimationFrame(raf);
  }, [tip]);

  if (!tip) return null;
  return createPortal(
    <div ref={boxRef} className="ui-tooltip" aria-hidden="true" style={{ visibility: 'hidden' }}>
      <span>{tip.text}</span>
      {tip.keys.length > 0 && (
        <span className="ui-tooltip-keys">
          {tip.keys.map((k, i) => (
            <kbd key={i}>{k}</kbd>
          ))}
        </span>
      )}
    </div>,
    document.body,
  );
}
