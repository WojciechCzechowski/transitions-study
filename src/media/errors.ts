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
