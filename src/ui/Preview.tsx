import { useEffect, useRef, useState } from 'react';
import { StudyError } from '../media/errors';
import type { PreviewController } from '../playback/PreviewController';
import { Renderer } from '../render/Renderer';

export type LoadState =
  /** `done`/`total` are bytes for the clips phase (total is 0 when the server does not say). */
  | { status: 'loading'; phase: 'manifest' | 'clips' | 'first-frame'; done: number; total: number }
  | { status: 'ready' }
  | { status: 'error'; error: StudyError };

interface Props {
  controller: PreviewController;
  load: LoadState;
  onRetry: () => void;
}

/**
 * The preview canvas. It is created once and never remounted; its drawing
 * buffer is resized only from a ResizeObserver, which redraws in the same
 * callback so a resize never shows a cleared canvas.
 */
export function Preview({ controller, load, onRetry }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [glError, setGlError] = useState<StudyError | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    let renderer: Renderer;
    try {
      renderer = new Renderer(canvas);
    } catch (e) {
      setGlError(e instanceof StudyError ? e : new StudyError('webgl', String(e)));
      return;
    }
    setGlError(null);
    renderer.onRestore = () => controller.redrawNow();

    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      const dpr = window.devicePixelRatio || 1;
      if (renderer.resize(box.width * dpr, box.height * dpr)) controller.redrawNow();
    });
    ro.observe(canvas);
    controller.attachRenderer(renderer);
    return () => {
      ro.disconnect();
      controller.attachRenderer(null);
      renderer.dispose();
    };
  }, [controller]);

  const error = glError ?? (load.status === 'error' ? load.error : null);

  return (
    <div className="preview">
      <canvas ref={canvasRef} className="preview-canvas" aria-label="Preview" role="img" />
      {error ? (
        <div className="preview-overlay preview-error" role="alert">
          <h2>{error.kind === 'webgl' ? 'Preview unavailable' : 'Couldn’t load the clips'}</h2>
          <p>{error.message}</p>
          {error.file && (
            <p className="muted">
              File: <code>{error.file}</code>
            </p>
          )}
          {error.hint && <p className="muted">{error.hint}</p>}
          {error.kind !== 'webgl' && (
            <button type="button" className="btn" onClick={onRetry}>
              Retry
            </button>
          )}
        </div>
      ) : load.status === 'loading' ? (
        <div className="preview-overlay" role="status" aria-live="polite">
          <p>{loadingText(load)}</p>
          <div
            className="progress"
            role="progressbar"
            aria-label="Loading clips"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(loadingPercent(load))}
          >
            <div className="progress-fill" style={{ width: `${loadingPercent(load)}%` }} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

type Loading = Extract<LoadState, { status: 'loading' }>;

const mb = (bytes: number) => (bytes / 2 ** 20).toFixed(1);

function loadingText(l: Loading): string {
  if (l.phase === 'manifest') return 'Loading clips…';
  if (l.phase === 'first-frame') return 'Preparing the first frame…';
  return l.total > 0 ? `Loading clips: ${mb(l.done)} / ${mb(l.total)} MB` : `Loading clips: ${mb(l.done)} MB`;
}

function loadingPercent(l: Loading): number {
  if (l.phase === 'first-frame') return 100;
  if (l.phase === 'clips' && l.total > 0) return Math.min(100, (100 * l.done) / l.total);
  return 0;
}
