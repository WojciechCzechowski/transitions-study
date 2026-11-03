export type MediaErrorKind =
  | 'manifest'
  | 'not-found'
  | 'unsupported'
  | 'decode'
  | 'network'
  | 'timeout'
  | 'too-short'
  | 'webgl';

/** A failure the UI can explain: what broke, which file, and what to do. */
export class StudyError extends Error {
  constructor(
    readonly kind: MediaErrorKind,
    message: string,
    readonly file?: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'StudyError';
  }
}

export function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

export function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError');
}

const MEDIA_ERROR_KIND: Record<number, MediaErrorKind> = {
  2: 'network',
  3: 'decode',
  4: 'unsupported',
};

export function fromMediaElementError(video: HTMLVideoElement, file: string): StudyError {
  const code = video.error?.code ?? 0;
  const kind = MEDIA_ERROR_KIND[code] ?? 'decode';
  const what =
    kind === 'network'
      ? 'A network error interrupted loading'
      : kind === 'unsupported'
        ? 'The browser cannot play this file (missing, or an unsupported format)'
        : 'The browser could not decode this file';
  const detail = video.error?.message ? ` (${video.error.message})` : '';
  return new StudyError(kind, `${what}${detail}.`, file, 'Re-generate clips with `npm run clips`, then Retry.');
}
