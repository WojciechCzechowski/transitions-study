import { useEffect, useRef, useState } from 'react';
import { StudyError } from '../media/errors';
import type { PreviewController } from '../playback/PreviewController';
import { Renderer } from '../render/Renderer';

export type LoadState =
  | { status: 'loading'; phase: 'manifest' | 'frames'; done: number; total: number }
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
          <p>
            {load.phase === 'manifest'
              ? 'Loading clips…'
              : `Preparing frames around the cut: ${load.done} / ${load.total}`}
          </p>
          <div
            className="progress"
            role="progressbar"
            aria-label="Decoding frames"
            aria-valuemin={0}
            aria-valuemax={Math.max(1, load.total)}
            aria-valuenow={load.done}
          >
            <div className="progress-fill" style={{ width: `${load.total ? (100 * load.done) / load.total : 0}%` }} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
