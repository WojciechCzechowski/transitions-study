import { useEffect, useMemo, useRef, useState } from 'react';
import { DECODE, SCENARIOS } from './config/study.config';
import { TRANSITION_DEFAULTS } from './config/transitions.config';
import { decodeFrames, type DecodeJob } from './media/decoder';
import { isAbort, StudyError } from './media/errors';
import { FrameStore } from './media/FrameStore';
import { loadManifest, type Manifest, type ManifestClip } from './media/manifest';
import { framesInRange, planDecode, type DecodeRange } from './model/decodePlan';
import { createDoc } from './model/timeline';
import { FPS } from './model/time';
import { PreviewController } from './playback/PreviewController';
import { Editor } from './ui/Editor';
import { installModalityTracking, useAnnouncer, useReducedMotion } from './ui/hooks';
import { Preview, type LoadState } from './ui/Preview';

function toStudyError(e: unknown): StudyError {
  if (e instanceof StudyError) return e;
  return new StudyError('decode', e instanceof Error ? e.message : String(e));
}

export function App() {
  const reducedMotion = useReducedMotion();
  const [store] = useState(() => new FrameStore());
  const [controller] = useState(() => new PreviewController(store));
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [manifestVersion, setManifestVersion] = useState(0);
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0]!.id);
  const [load, setLoad] = useState<LoadState>({ status: 'loading', phase: 'manifest', done: 0, total: 0 });
  const [attempt, setAttempt] = useState(0);
  const hostRef = useRef<HTMLDivElement>(null);
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

  const scenario = SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0]!;
  const docResult = useMemo(() => (manifest ? createDoc(manifest.clips, scenario.layout) : null), [manifest, scenario]);

  // 2. Pre-decode the frames around the cut for this scenario.
  useEffect(() => {
    if (!manifest || !docResult) return;
    if (!docResult.ok) {
      setLoad({
        status: 'error',
        error: new StudyError(
          'too-short',
          `${docResult.clip.label} has ${docResult.available} frames; the “${scenario.label}” layout needs ${docResult.needed}.`,
          docResult.clip.file,
          'Use a longer source (scripts/normalize-clips.mjs) or change the layout in src/config/study.config.ts.',
        ),
      });
      return;
    }

    const ac = new AbortController();
    const doc = docResult.doc;
    const [clipA, clipB] = manifest.clips;
    // Both clips are normalised to the same size; plan with clip A's.
    const plan = planDecode({
      doc,
      leadIn: TRANSITION_DEFAULTS.preview.leadIn,
      tail: TRANSITION_DEFAULTS.preview.tail,
      sourceWidth: clipA.width,
      sourceHeight: clipA.height,
      capBytes: DECODE.capBytes,
      minScale: DECODE.minScale,
    });
    const ranges = [plan.a, plan.b];
    const inPlan = (clipId: string, f: number) =>
      ranges.some((r) => r.clipId === clipId && f >= r.start && f < r.end);

    controller.setReady(false);
    store.retain((clipId, f, w, h) => w === plan.width && h === plan.height && inPlan(clipId, f));

    let done = 0;
    let raf = 0;
    const total = plan.frameCount;
    const flush = () => {
      raf = 0;
      setLoad({ status: 'loading', phase: 'frames', done, total });
    };
    setLoad({ status: 'loading', phase: 'frames', done: 0, total });

    const job = (r: DecodeRange, clip: ManifestClip): DecodeJob => ({
      clipId: r.clipId,
      file: clip.file,
      sourceFrames: clip.frames,
      frames: framesInRange(r),
      width: plan.width,
      height: plan.height,
      fps: FPS,
    });
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

    Promise.all([decodeFrames(job(plan.a, clipA), store, opts), decodeFrames(job(plan.b, clipB), store, opts)])
      .then(() => {
        if (ac.signal.aborted) return;
        cancelAnimationFrame(raf);
        setLoad({ status: 'ready' });
        controller.setReady(true);
        if (plan.trimmed || plan.overCap) {
          console.warn('[decode] memory cap reached: some frames far from the cut were not decoded', plan);
        }
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
  }, [manifest, docResult, scenario.label, controller, store]);

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>Transition study</h1>
          <p className="muted">Unofficial interaction study: two clips, one cut, one transition.</p>
        </div>
        <label className="scenario">
          <span className="muted">Handles</span>
          <select value={scenarioId} onChange={(e) => setScenarioId(e.currentTarget.value)}>
            {SCENARIOS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </header>

      <main className="workspace">
        <Preview controller={controller} load={load} onRetry={() => setAttempt((a) => a + 1)} />
        {docResult?.ok && (
          <Editor
            key={`${scenarioId}:${manifestVersion}`}
            baseDoc={docResult.doc}
            controller={controller}
            ready={load.status === 'ready'}
            reducedMotion={reducedMotion}
            announce={announce}
          />
        )}
      </main>

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        <span key={message.n}>{message.text}</span>
      </div>
      <div ref={hostRef} className="decode-host" aria-hidden="true" />
    </div>
  );
}
