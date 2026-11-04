import { useEffect, useState, type CSSProperties, type ReactNode, type Ref } from 'react';
import {
  clampSidebar,
  clampTimeline,
  DEFAULT_SIZES,
  parseStoredLayout,
  sidebarRange,
  timelineRange,
  type PaneSizes,
} from '../model/layout';
import { useElementSize } from './hooks';
import { Splitter } from './Splitter';

const STORAGE_KEY = 'transition-study.layout.v1';

function readStored(): PaneSizes {
  try {
    return parseStoredLayout(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_SIZES;
  }
}

/** Desired pane sizes, remembered per browser. Rendering re-clamps them to the window. */
function usePaneSizes() {
  const [sizes, setSizes] = useState<PaneSizes>(readStored);
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sizes));
      } catch {
        // Storage can be unavailable (private mode, blocked site data); sizes just won't persist.
      }
    }, 200);
    return () => clearTimeout(id);
  }, [sizes]);
  return [sizes, setSizes] as const;
}

interface Props {
  header: ReactNode;
  preview: ReactNode;
  /** Slot elements the editor portals its sidebar (rail + panel) and timeline into. */
  sidebarRef: Ref<HTMLElement>;
  timelineRef: Ref<HTMLElement>;
}

/**
 * Full-window workspace: top bar, then a resizable sidebar beside the preview,
 * above a resizable timeline. Rendered once by App, so the preview canvas
 * never remounts.
 */
export function Shell({ header, preview, sidebarRef, timelineRef }: Props) {
  const [bodyRef, body] = useElementSize<HTMLDivElement>();
  const [sizes, setSizes] = usePaneSizes();
  const measured = body.width > 0 && body.height > 0;

  const sidebar = measured ? clampSidebar(sizes.sidebar, body.width) : sizes.sidebar;
  const timeline = measured ? clampTimeline(sizes.timeline, body.height) : sizes.timeline;
  const sRange = sidebarRange(body.width);
  const tRange = timelineRange(body.height);

  const style = { '--sidebar-w': `${sidebar}px`, '--timeline-h': `${timeline}px` } as CSSProperties;

  return (
    <div className="app">
      <header className="topbar">{header}</header>
      <div className="body" ref={bodyRef} style={style}>
        <div className="top">
          <aside className="sidebar" ref={sidebarRef} />
          <Splitter
            orientation="vertical"
            label="Resize sidebar"
            value={sidebar}
            range={sRange}
            defaultValue={DEFAULT_SIZES.sidebar}
            direction={1}
            onChange={(v) => setSizes((s) => ({ ...s, sidebar: clampSidebar(v, body.width) }))}
          />
          <div className="preview-area">{preview}</div>
        </div>
        <Splitter
          orientation="horizontal"
          label="Resize timeline"
          value={timeline}
          range={tRange}
          defaultValue={DEFAULT_SIZES.timeline}
          direction={-1}
          onChange={(v) => setSizes((s) => ({ ...s, timeline: clampTimeline(v, body.height) }))}
        />
        <section className="timeline-pane" aria-label="Timeline" ref={timelineRef} />
      </div>
    </div>
  );
}
