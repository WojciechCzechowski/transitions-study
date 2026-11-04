import { useEffect, useMemo, useState } from 'react';
import { DECODE, START_LAYOUT } from './config/study.config';
import { checkDecoderSupport, ClipDecoder } from './media/ClipDecoder';
import { isAbort, StudyError } from './media/errors';
import { FrameFeeder } from './media/FrameFeeder';
import { FrameStore } from './media/FrameStore';
import { fetchClip, loadManifest, type Manifest } from './media/manifest';
import { parseMp4 } from './media/mp4';
import { createDoc, type Source } from './model/timeline';
import { PreviewController } from './playback/PreviewController';
import { Editor } from './ui/Editor';
import { installModalityTracking, useAnnouncer, useReducedMotion } from './ui/hooks';
import { Preview, type LoadState } from './ui/Preview';
import { Shell } from './ui/Shell';
import { ShortcutsDialog } from './ui/ShortcutsDialog';
import { TooltipLayer } from './ui/Tooltip';

function toStudyError(e: unknown): StudyError {
  if (e instanceof StudyError) return e;
  return new StudyError('decode', e instanceof Error ? e.message : String(e));
}

export function App() {
  const reducedMotion = useReducedMotion();
  const [store] = useState(() => new FrameStore(DECODE.cacheBytes));
  const [feeder, setFeeder] = useState<FrameFeeder | null>(null);
  const [controller] = useState(() => new PreviewController(store));
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [manifestVersion, setManifestVersion] = useState(0);
  const [load, setLoad] = useState<LoadState>({ status: 'loading', phase: 'manifest', done: 0, total: 0 });
  const [attempt, setAttempt] = useState(0);
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

  // 2. Download and index every library clip, then decode frames on demand.
  //    Only frames the preview needs now (and next) are decoded, into a capped
  //    cache, so memory does not grow with clip length.
  useEffect(() => {
    if (!manifest) return;
    const ac = new AbortController();
    const loaded = new Map<string, number>();
    const totals = new Map<string, number>();
    const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
    let raf = 0;
    const flush = () => {
      raf = 0;
      setLoad({ status: 'loading', phase: 'clips', done: sum(loaded), total: sum(totals) });
    };
    let feeder: FrameFeeder | null = null;
    const decoders: ClipDecoder[] = [];
    const fail = (e: unknown) => {
      if (isAbort(e) || ac.signal.aborted) return;
      ac.abort();
      cancelAnimationFrame(raf);
      setLoad({ status: 'error', error: toStudyError(e) });
    };

    controller.setReady(false);
    setLoad({ status: 'loading', phase: 'clips', done: 0, total: 0 });

    (async () => {
      const parsed = await Promise.all(
        manifest.clips.map(async (clip) => {
          const bytes = await fetchClip(clip.file, ac.signal, (n, total) => {
            loaded.set(clip.id, n);
            totals.set(clip.id, total);
            if (!raf) raf = requestAnimationFrame(flush);
          });
          const track = parseMp4(bytes, clip.file);
          if (track.samples.length < clip.frames) {
            throw new StudyError(
              'too-short',
              `The file has ${track.samples.length} frames but the manifest says ${clip.frames}.`,
              clip.file,
              'Regenerate the manifest with the clip scripts, then Retry.',
            );
          }
          await checkDecoderSupport(track, clip.file);
          return { clip, bytes, track };
        }),
      );
      if (ac.signal.aborted) return;
      cancelAnimationFrame(raf);
      raf = 0;

      for (const p of parsed) decoders.push(new ClipDecoder(p.clip.id, p.clip.file, p.bytes, p.track));
      feeder = new FrameFeeder(
        store,
        new Map(decoders.map((d) => [d.sourceId, d])),
        () => controller.framesArrived(),
        (_sourceId, e) => fail(e),
      );
      const frameBytes = Math.max(...parsed.map((p) => p.track.width * p.track.height * 4));
      const maxFrames = Math.max(2, Math.floor(DECODE.cacheBytes / frameBytes));
      setFeeder(feeder);
      setLoad({ status: 'loading', phase: 'first-frame', done: 0, total: 0 });
      controller.setFeeder(feeder, maxFrames);
      controller.setReady(true);
      await controller.firstFrame();
      if (ac.signal.aborted) return;
      setLoad({ status: 'ready' });
      const mb = (n: number) => (n / 2 ** 20).toFixed(0);
      console.info(
        `[decode] ${parsed.length} clips loaded (${mb(sum(loaded))} MB); decoding on demand into a ${mb(DECODE.cacheBytes)} MB cache (${maxFrames} frames)`,
      );
    })().catch(fail);

    return () => {
      ac.abort();
      cancelAnimationFrame(raf);
      controller.setReady(false);
      controller.setFeeder(null);
      feeder?.dispose();
      for (const d of decoders) d.close();
      store.clear();
      setFeeder(null);
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
      <span className="topbar-note muted">
        Unofficial interaction study
        {manifest?.credit && (
          <>
            {' · '}
            {manifest.credit.url ? (
              <a href={manifest.credit.url} target="_blank" rel="noreferrer">
                {manifest.credit.text}
              </a>
            ) : (
              manifest.credit.text
            )}
          </>
        )}
      </span>
      <ShortcutsDialog />
      <TooltipLayer />
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
          feeder={feeder}
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
    </>
  );
}
