/**
 * Frame-accurate pre-decoding with a plain <video> element (no demuxer
 * dependency). For each source frame: seek to the frame's centre, wait for
 * `seeked` (and the presented-frame callback where supported, to verify the
 * frame index), draw it at the planned size onto a canvas, and snapshot that
 * canvas into an ImageBitmap.
 */
import type { Frames } from '../model/time';
import { abortError, fromMediaElementError, StudyError } from './errors';
import type { FrameStore } from './FrameStore';
import { checkClipFile, clipUrl } from './manifest';

export interface DecodeJob {
  readonly clipId: string;
  readonly file: string;
  /** Source frames the file should contain, from the manifest. */
  readonly sourceFrames: Frames;
  /** Frames to decode, ascending. */
  readonly frames: readonly Frames[];
  readonly width: number;
  readonly height: number;
  readonly fps: number;
}

export interface DecodeOptions {
  readonly signal: AbortSignal;
  /** Called once per frame, including frames already in the store. */
  readonly onFrame: () => void;
  readonly seekTimeoutMs: number;
  readonly loadTimeoutMs: number;
  /** Element the hidden <video> is attached to (it must be in the document to present frames). */
  readonly host: HTMLElement;
}

export interface DecodeStats {
  readonly decoded: number;
  readonly reused: number;
  /** Frames whose presented index could not be confirmed after retries. */
  readonly unverified: number;
}

/** How long to wait after `seeked` for the presented-frame callback. */
const PRESENT_GRACE_MS = 120;
/** Stop waiting for the callback after this many consecutive misses (e.g. the browser skips presenting hidden video). */
const MAX_PRESENT_MISSES = 2;
const MAX_ATTEMPTS = 3;

/** Whether to keep using requestVideoFrameCallback for verification during one job. */
interface Presenter {
  enabled: boolean;
  misses: number;
}

type VideoWithRvfc = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

export async function decodeFrames(job: DecodeJob, store: FrameStore, opts: DecodeOptions): Promise<DecodeStats> {
  const { signal } = opts;
  const pending = job.frames.filter((f) => !store.has(job.clipId, f, job.width, job.height));
  const reused = job.frames.length - pending.length;
  for (let i = 0; i < reused; i++) opts.onFrame();
  if (pending.length === 0) return { decoded: 0, reused, unverified: 0 };

  await checkClipFile(job.file, signal);

  const video = document.createElement('video') as VideoWithRvfc;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.tabIndex = -1;
  video.setAttribute('aria-hidden', 'true');
  opts.host.appendChild(video);

  let unverified = 0;
  try {
    await loadVideo(video, clipUrl(job.file), job.file, opts.loadTimeoutMs, signal);
    if (video.videoWidth === 0) {
      throw new StudyError('decode', 'The file has no video track the browser can show.', job.file);
    }
    const fileFrames = Math.round(video.duration * job.fps);
    if (Number.isFinite(video.duration) && fileFrames + 1 < job.sourceFrames) {
      throw new StudyError(
        'too-short',
        `The file has about ${fileFrames} frames but the manifest says ${job.sourceFrames}.`,
        job.file,
        'Regenerate the manifest with the clip scripts, then Retry.',
      );
    }

    const canvas = document.createElement('canvas');
    canvas.width = job.width;
    canvas.height = job.height;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new StudyError('decode', 'Could not create a 2D canvas for decoding.', job.file);

    const presenter: Presenter = { enabled: typeof video.requestVideoFrameCallback === 'function', misses: 0 };
    for (const f of pending) {
      if (signal.aborted) throw abortError();
      const ok = await seekToFrame(video, f, job, opts, presenter);
      if (!ok) unverified++;
      ctx.drawImage(video, 0, 0, job.width, job.height);
      const bitmap = await createImageBitmap(canvas);
      if (signal.aborted) {
        bitmap.close();
        throw abortError();
      }
      store.put(job.clipId, f, bitmap, job.width, job.height);
      opts.onFrame();
    }
  } finally {
    video.removeAttribute('src');
    video.load();
    video.remove();
  }
  if (unverified > 0) {
    console.warn(`[decode] ${job.file}: ${unverified} frame(s) could not be verified via requestVideoFrameCallback`);
  }
  return { decoded: pending.length, reused, unverified };
}

function loadVideo(video: HTMLVideoElement, url: string, file: string, timeoutMs: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener('loadeddata', onLoaded);
      video.removeEventListener('error', onError);
      signal.removeEventListener('abort', onAbort);
    };
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(fromMediaElementError(video, file));
    };
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new StudyError('timeout', `Loading timed out after ${timeoutMs / 1000} s.`, file, 'Retry, or check the file plays in this browser.'));
    }, timeoutMs);
    video.addEventListener('loadeddata', onLoaded);
    video.addEventListener('error', onError);
    signal.addEventListener('abort', onAbort);
    video.src = url;
  });
}

/** Seek to the centre of frame `f`. Resolves true when the presented frame was verified (or can't be checked). */
async function seekToFrame(
  video: VideoWithRvfc,
  f: Frames,
  job: DecodeJob,
  opts: DecodeOptions,
  presenter: Presenter,
): Promise<boolean> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const mediaTime = await seekOnce(video, (f + 0.5) / job.fps, job.file, opts, presenter);
    if (mediaTime === null) return true; // No callback support or it didn't fire; `seeked` is authoritative.
    // mediaTime is the presented frame's PTS (its start, f / fps). Accept that or the frame centre;
    // reject the neighbours (±1 frame).
    const d = mediaTime * job.fps - f;
    if (d > -0.05 && d < 0.55) return true;
  }
  return false;
}

/** One seek. Resolves with the presented frame's mediaTime when the browser reports it, else null. */
function seekOnce(
  video: VideoWithRvfc,
  time: number,
  file: string,
  opts: DecodeOptions,
  presenter: Presenter,
): Promise<number | null> {
  const { signal, seekTimeoutMs } = opts;
  return new Promise<number | null>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    let presented: number | null = null;
    let seeked = false;
    let rvfcId: number | null = null;
    let grace: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      clearTimeout(timer);
      clearTimeout(grace);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      signal.removeEventListener('abort', onAbort);
      if (rvfcId !== null) video.cancelVideoFrameCallback?.(rvfcId);
    };
    const finish = () => {
      cleanup();
      resolve(presented);
    };
    const onSeeked = () => {
      seeked = true;
      if (presented !== null || rvfcId === null) finish();
      else
        grace = setTimeout(() => {
          if (++presenter.misses >= MAX_PRESENT_MISSES) presenter.enabled = false;
          finish();
        }, PRESENT_GRACE_MS);
    };
    const onError = () => {
      cleanup();
      reject(fromMediaElementError(video, file));
    };
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new StudyError('timeout', `Seeking to ${time.toFixed(3)} s timed out.`, file, 'Retry, or regenerate the clip with a short GOP.'));
    }, seekTimeoutMs);

    if (presenter.enabled && video.requestVideoFrameCallback) {
      rvfcId = video.requestVideoFrameCallback((_now, meta) => {
        rvfcId = null;
        presented = meta.mediaTime;
        presenter.misses = 0;
        if (seeked) finish();
      });
    }
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    signal.addEventListener('abort', onAbort);
    video.currentTime = time;
  });
}
