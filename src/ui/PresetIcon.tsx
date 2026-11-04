import type { ReactNode } from 'react';
import type { PresetId } from '../config/transitions.config';

/** Static schematic glyphs for the gallery tiles (no motion, so safe under reduced motion). */
export function PresetIcon({ id }: { id: PresetId }) {
  return (
    <svg className="preset-icon" viewBox="0 0 48 30" aria-hidden="true" focusable="false">
      {GLYPHS[id]}
    </svg>
  );
}

const A = 'var(--clip-a-strong)';
const B = 'var(--clip-b-strong)';

const GLYPHS: Record<PresetId, ReactNode> = {
  crossDissolve: (
    <>
      <rect x="4" y="5" width="24" height="20" rx="2" fill={A} />
      <rect x="20" y="5" width="24" height="20" rx="2" fill={B} opacity="0.7" />
    </>
  ),
  dipToBlack: (
    <>
      <rect x="2" y="7" width="13" height="16" rx="2" fill={A} />
      <rect x="17.5" y="7" width="13" height="16" rx="2" fill="#000" stroke="currentColor" strokeOpacity="0.4" />
      <rect x="33" y="7" width="13" height="16" rx="2" fill={B} />
    </>
  ),
  push: (
    <>
      <rect x="2" y="5" width="20" height="20" rx="2" fill={A} />
      <rect x="22" y="5" width="20" height="20" rx="2" fill={B} />
      <path d="M38 15H12m5-4-5 4 5 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  wipe: (
    <>
      <defs>
        <linearGradient id="wipe-edge" x1="0" x2="1">
          <stop offset="0.42" stopColor={B} />
          <stop offset="0.58" stopColor={A} />
        </linearGradient>
      </defs>
      <rect x="4" y="5" width="40" height="20" rx="2" fill="url(#wipe-edge)" />
      <path d="M24 3v24" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 2" />
    </>
  ),
  zoom: (
    <>
      <rect x="4" y="3" width="40" height="24" rx="2" fill={A} />
      <rect x="13" y="8.5" width="22" height="13" rx="1.5" fill={B} />
      <path d="M8 6l5 3m27-3-5 3M8 24l5-3m27 3-5-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </>
  ),
  blur: (
    <>
      <rect x="4" y="5" width="40" height="20" rx="2" fill={A} opacity="0.55" />
      <circle cx="24" cy="15" r="8" fill={B} opacity="0.35" />
      <circle cx="24" cy="15" r="5" fill={B} opacity="0.6" />
      <circle cx="24" cy="15" r="2.5" fill={B} />
    </>
  ),
};
