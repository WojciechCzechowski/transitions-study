import { CLIPS_BASE_URL, MANIFEST_URL } from '../config/study.config';
import { FPS } from '../model/time';
import { StudyError } from './errors';

export interface ManifestClip {
  readonly id: string;
  readonly label: string;
  readonly file: string;
  readonly frames: number;
  readonly width: number;
  readonly height: number;
}

/** Who made the footage, shown in the top bar (e.g. "Footage: Pexels"). */
export interface FootageCredit {
  readonly text: string;
  /** https only. */
  readonly url?: string;
}

export interface Manifest {
  readonly fps: number;
  readonly source: string;
  readonly credit?: FootageCredit;
  /** Library clips, in manifest order. The starting timeline uses the first two. */
  readonly clips: readonly ManifestClip[];
}

export const clipUrl = (file: string) => `${CLIPS_BASE_URL}${encodeURIComponent(file)}`;

/** A response is "missing" if it failed, or if a dev-server SPA fallback answered with HTML. */
function looksMissing(res: Response): boolean {
  return !res.ok || (res.headers.get('content-type') ?? '').includes('text/html');
}

const HINT = 'Run `npm run clips` (or `npm run clips:normalize -- <videos or folder>`), then Retry.';

export async function loadManifest(signal: AbortSignal): Promise<Manifest> {
  let res: Response;
  try {
    res = await fetch(MANIFEST_URL, { signal, cache: 'no-cache' });
  } catch (e) {
    if (signal.aborted) throw e;
    throw new StudyError('network', 'Could not fetch the clip manifest.', 'manifest.json', HINT);
  }
  if (looksMissing(res)) {
    throw new StudyError('manifest', `${MANIFEST_URL} was not found.`, 'manifest.json', HINT);
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new StudyError('manifest', 'manifest.json is not valid JSON.', 'manifest.json', HINT);
  }
  return validate(data);
}

function validate(data: unknown): Manifest {
  const bad = (why: string) => new StudyError('manifest', `manifest.json: ${why}.`, 'manifest.json', HINT);
  if (typeof data !== 'object' || data === null) throw bad('expected an object');
  const m = data as Record<string, unknown>;
  if (m.fps !== FPS) throw bad(`expected fps ${FPS}, got ${String(m.fps)}`);
  if (!Array.isArray(m.clips) || m.clips.length < 2) throw bad('expected at least two clips');
  const clips = m.clips.map((c: unknown, i) => {
    const o = (c ?? {}) as Record<string, unknown>;
    const ok =
      typeof o.id === 'string' &&
      typeof o.file === 'string' &&
      Number.isInteger(o.frames) &&
      (o.frames as number) > 0 &&
      Number.isInteger(o.width) &&
      Number.isInteger(o.height);
    if (!ok) throw bad(`clip ${i + 1} is missing id, file, frames, width or height`);
    return {
      id: o.id as string,
      label: typeof o.label === 'string' ? o.label : `Clip ${i + 1}`,
      file: o.file as string,
      frames: o.frames as number,
      width: o.width as number,
      height: o.height as number,
    };
  });
  const ids = new Set(clips.map((c) => c.id));
  if (ids.size !== clips.length) throw bad('clip ids must be unique');
  const source = typeof m.source === 'string' ? m.source : 'unknown';
  const credit = readCredit(m.credit);
  return credit ? { fps: FPS, source, credit, clips } : { fps: FPS, source, clips };
}

function readCredit(c: unknown): FootageCredit | undefined {
  if (typeof c !== 'object' || c === null) return undefined;
  const o = c as Record<string, unknown>;
  if (typeof o.text !== 'string' || o.text.trim() === '') return undefined;
  const url = typeof o.url === 'string' && /^https:\/\//.test(o.url) ? o.url : undefined;
  return url ? { text: o.text, url } : { text: o.text };
}

/** Size of a clip file from its response headers, or 0 when unknown. */
function declaredLength(res: Response): number {
  const n = Number(res.headers.get('content-length'));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Download a whole clip file. `onProgress` gets the bytes received so far and
 * the declared size (0 when the server does not say).
 */
export async function fetchClip(
  file: string,
  signal: AbortSignal,
  onProgress: (loaded: number, total: number) => void,
): Promise<Uint8Array> {
  let res: Response;
  try {
    res = await fetch(clipUrl(file), { signal, cache: 'no-cache' });
  } catch (e) {
    if (signal.aborted) throw e;
    throw new StudyError('network', 'Could not reach the clip file.', file, HINT);
  }
  if (looksMissing(res)) {
    throw new StudyError('not-found', `${clipUrl(file)} was not found (HTTP ${res.status}).`, file, HINT);
  }
  const total = declaredLength(res);
  onProgress(0, total);
  if (!res.body) {
    const bytes = new Uint8Array(await res.arrayBuffer());
    onProgress(bytes.length, total);
    return bytes;
  }
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let loaded = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      loaded += value.length;
      onProgress(loaded, total);
    }
  } catch (e) {
    if (signal.aborted) throw e;
    throw new StudyError('network', 'The download of the clip file was interrupted.', file, HINT);
  }
  const bytes = new Uint8Array(loaded);
  let o = 0;
  for (const p of parts) {
    bytes.set(p, o);
    o += p.length;
  }
  return bytes;
}
