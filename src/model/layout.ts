/**
 * Pure layout rules for the resizable workspace: pane size limits, keyboard
 * steps for the splitters, tolerant parsing of the stored sizes, and which
 * level of the Transitions sidebar is showing.
 */

export const LAYOUT = {
  sidebar: { default: 340, min: 240 },
  timeline: { default: 280, min: 180 },
  /** Space the preview area keeps beside the sidebar. */
  previewMin: 320,
  /** Height the sidebar/preview row keeps above the timeline. */
  topMin: 200,
  /** Thickness of a splitter's grid track. */
  splitter: 6,
  step: 16,
  bigStep: 64,
} as const;

export interface PaneSizes {
  readonly sidebar: number;
  readonly timeline: number;
}

export const DEFAULT_SIZES: PaneSizes = {
  sidebar: LAYOUT.sidebar.default,
  timeline: LAYOUT.timeline.default,
};

export interface Range {
  readonly min: number;
  readonly max: number;
}

/** Allowed sidebar widths for a given body width. Min wins when space runs out. */
export function sidebarRange(bodyWidth: number): Range {
  const min = LAYOUT.sidebar.min;
  return { min, max: Math.max(min, Math.floor(bodyWidth - LAYOUT.splitter - LAYOUT.previewMin)) };
}

/** Allowed timeline heights for a given body height. Min wins when space runs out. */
export function timelineRange(bodyHeight: number): Range {
  const min = LAYOUT.timeline.min;
  return { min, max: Math.max(min, Math.floor(bodyHeight - LAYOUT.splitter - LAYOUT.topMin)) };
}

const clampTo = (v: number, r: Range) => Math.min(r.max, Math.max(r.min, Math.round(v)));

export const clampSidebar = (width: number, bodyWidth: number) => clampTo(width, sidebarRange(bodyWidth));
export const clampTimeline = (height: number, bodyHeight: number) => clampTo(height, timelineRange(bodyHeight));

/**
 * Next splitter value for a key press, or null when the key isn't handled.
 * `grow` is the arrow direction that makes the pane bigger.
 */
export function stepSize(
  key: string,
  shift: boolean,
  value: number,
  range: Range,
  grow: 'ArrowRight' | 'ArrowUp',
): number | null {
  const shrink = grow === 'ArrowRight' ? 'ArrowLeft' : 'ArrowDown';
  const step = shift ? LAYOUT.bigStep : LAYOUT.step;
  let next: number;
  if (key === grow) next = value + step;
  else if (key === shrink) next = value - step;
  else if (key === 'Home') next = range.min;
  else if (key === 'End') next = range.max;
  else return null;
  return clampTo(next, range);
}

/** Reads stored sizes; anything missing or malformed falls back to the defaults. */
export function parseStoredLayout(raw: string | null | undefined): PaneSizes {
  if (!raw) return DEFAULT_SIZES;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return DEFAULT_SIZES;
  }
  if (typeof data !== 'object' || data === null) return DEFAULT_SIZES;
  const rec = data as Record<string, unknown>;
  const pick = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : fallback);
  return {
    sidebar: pick(rec.sidebar, DEFAULT_SIZES.sidebar),
    timeline: pick(rec.timeline, DEFAULT_SIZES.timeline),
  };
}

export type SidebarView = 'pick' | 'edit';

/**
 * Level 2 (edit) shows only for a selected transition that isn't being swapped;
 * everything else shows level 1 (pick).
 */
export function sidebarView(s: { hasTransition: boolean; selected: boolean; changing: boolean }): SidebarView {
  return s.hasTransition && s.selected && !s.changing ? 'edit' : 'pick';
}
