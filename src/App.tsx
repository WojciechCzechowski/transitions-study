import { useEffect, useMemo, useRef, useState } from 'react';
import { DECODE, START_LAYOUT } from './config/study.config';
import { decodeFrames } from './media/decoder';
import { isAbort, StudyError } from './media/errors';
import { FrameStore } from './media/FrameStore';
import { loadManifest, type Manifest } from './media/manifest';
import { framesInRange, planLibraryDecode } from './model/decodePlan';
import { createDoc, type Source } from './model/timeline';
import { FPS } from './model/time';
import { PreviewController } from './playback/PreviewController';
import { Editor } from './ui/Editor';
import { installModalityTracking, useAnnouncer, useReducedMotion } from './ui/hooks';
import { Preview, type LoadState } from './ui/Preview';
import { Shell } from './ui/Shell';

function toStudyError(e: unknown): StudyError {
  if (e instanceof StudyError) return e;
  return new StudyError('decode', e instanceof Error ? e.message : String(e));
}

/** Run async jobs with at most `limit` in flight; rejects on the first failure. */
async function pool<T>(items: readonly T[], limit: number, run: (item: T) => Promise<unknown>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await run(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
}

export function App() {
  const reducedMotion = useReducedMotion();
  const [store] = useState(() => new FrameStore());
  const [controller] = useState(() => new PreviewController(store));
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [manifestVersion, setManifestVersion] = useState(0);
  const [load, setLoad] = useState<LoadState>({ status: 'loading', phase: 'manifest', done: 0, total: 0 });
  const [attempt, setAttempt] = useState(0);
  const hostRef = useRef<HTMLDivElement>(null);
  const [sidebarEl, setSidebarEl] = useState<HTMLElement | null>(null);
  const [timelineEl, setTimelineEl] = useState<HTMLElement | null>(null);
  const [message, announce] = useAnnouncer();

  useEffect(() => installModalityTracking(), []);
  useEffect(() => () => controller.dispose(), [controller]);

  // 1. Manifest (reloaded on Retry).
  useEffect(() => {
    const ac = new AbortController();
    setLoad({ status: 'loading', phase: 'manifest', done: 0, total: 0 });
    loadManifest(ac.signal)
      .then((m) => {
        setManifest(m);
        setManifestVersion((v) => v + 1);
      })
      .catch((e) => {
        if (!isAbort(e)) setLoad({ status: 'error', error: toStudyError(e) });
      });
    return () => ac.abort();
  }, [attempt]);

  const sources = useMemo<Source[]>(
    () => (manifest ? manifest.clips.map((c) => ({ id: c.id, label: c.label, file: c.file, frames: c.frames })) : []),
    [manifest],
  );
  const docResult = useMemo(() => (sources.length >= 2 ? createDoc(sources.slice(0, 2), START_LAYOUT) : null), [sources]);

  // 2. Pre-decode every frame of every library clip, once per manifest.
  //    Timeline clips are windows onto these, so edits never need new frames.
  useEffect(() => {
    if (!manifest) return;
    const ac = new AbortController();
    const first = manifest.clips[0]!;
    const plan = planLibraryDecode({
      sources: manifest.clips,
      sourceWidth: first.width,
      sourceHeight: first.height,
      capBytes: DECODE.capBytes,
      minScale: DECODE.minScale,
    });
    const inPlan = (sourceId: string, f: number) => plan.ranges.some((r) => r.sourceId === sourceId && f >= r.start && f < r.end);

    controller.setReady(false);
    store.retain((sourceId, f, w, h) => w === plan.width && h === plan.height && inPlan(sourceId, f));

    let done = 0;
    let raf = 0;
    const total = plan.frameCount;
    const flush = () => {
      raf = 0;
      setLoad({ status: 'loading', phase: 'frames', done, total });
    };
    setLoad({ status: 'loading', phase: 'frames', done: 0, total });

    const opts = {
      signal: ac.signal,
      onFrame: () => {
        done++;
        if (!raf) raf = requestAnimationFrame(flush);
      },
      seekTimeoutMs: DECODE.seekTimeoutMs,
      loadTimeoutMs: DECODE.loadTimeoutMs,
      host: hostRef.current!,
    };

    pool(plan.ranges, DECODE.concurrency, (r) => {
      const clip = manifest.clips.find((c) => c.id === r.sourceId)!;
      return decodeFrames(
        { clipId: r.sourceId, file: clip.file, sourceFrames: clip.frames, frames: framesInRange(r), width: plan.width, height: plan.height, fps: FPS },
        store,
        opts,
      );
    })
      .then(() => {
        if (ac.signal.aborted) return;
        cancelAnimationFrame(raf);
        setLoad({ status: 'ready' });
        controller.setReady(true);
        const note = `${plan.frameCount} frames at ${plan.width}×${plan.height} (scale ${plan.scale}, ${(plan.bytes / 2 ** 20).toFixed(0)} MB)`;
        if (plan.overCap) console.warn(`[decode] over the memory cap even at the minimum scale: ${note}`);
        else console.info(`[decode] library ready: ${note}`);
      })
      .catch((e) => {
        if (isAbort(e) || ac.signal.aborted) return;
        ac.abort();
        cancelAnimationFrame(raf);
        setLoad({ status: 'error', error: toStudyError(e) });
      });

    return () => {
      ac.abort();
      cancelAnimationFrame(raf);
    };
  }, [manifest, controller, store]);

  // A starting layout that doesn't fit the clips is shown like a load error.
  const layoutError =
    docResult && !docResult.ok
      ? new StudyError(
          'too-short',
          `${docResult.clip.label} has ${docResult.available} frames; the starting layout needs ${docResult.needed}.`,
          docResult.clip.file,
          'Use a longer source (scripts/normalize-clips.mjs) or change the layout in src/config/study.config.ts.',
        )
      : null;
  const shownLoad: LoadState = layoutError ? { status: 'error', error: layoutError } : load;

  const header = (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <span className="crumb-root">Transition study</span>
        <span className="crumb-sep" aria-hidden="true">/</span>
        <span className="crumb-current" aria-current="page">
          Untitled edit
        </span>
      </nav>
      <span className="spacer" />
      <span className="topbar-note muted">Unofficial interaction study</span>
    </>
  );

  return (
    <>
      <Shell
        header={header}
        preview={<Preview controller={controller} load={shownLoad} onRetry={() => setAttempt((a) => a + 1)} />}
        sidebarRef={setSidebarEl}
        timelineRef={setTimelineEl}
      />
      {docResult?.ok && sidebarEl && timelineEl && (
        <Editor
          key={manifestVersion}
          baseDoc={docResult.doc}
          sources={sources}
          store={store}
          controller={controller}
          ready={load.status === 'ready'}
          reducedMotion={reducedMotion}
          announce={announce}
          sidebarEl={sidebarEl}
          timelineEl={timelineEl}
        />
      )}

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        <span key={message.n}>{message.text}</span>
      </div>
      <div ref={hostRef} className="decode-host" aria-hidden="true" />
    </>
  );
}
