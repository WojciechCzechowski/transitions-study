/**
 * Decodes one clip on demand with WebCodecs, one keyframe group (GOP) at a time.
 *
 * Each GOP is fed whole and then flushed, so every call starts on a keyframe
 * with no decoder state carried over, and nothing waits on the decoder's
 * internal output delay. Every VideoFrame is copied into an ImageBitmap and
 * closed straight away, so the decoder's own frame pool never runs dry.
 */
import { THUMBS } from '../config/study.config';
import type { Frames } from '../model/time';
import { FPS } from '../model/time';
import { StudyError } from './errors';
import type { GopSource } from './FrameFeeder';
import { gopOf, gopRange, type Mp4Track } from './mp4';

const US_PER_FRAME = 1e6 / FPS;
const HINT = 'Use a current version of Chrome, Edge, Safari or Firefox.';

const decoderConfig = (t: Mp4Track): VideoDecoderConfig => ({
  codec: t.codec,
  description: t.description,
  codedWidth: t.width,
  codedHeight: t.height,
  optimizeForLatency: true,
});

/** Fail early, with a clear message, on browsers that cannot decode a track. */
export async function checkDecoderSupport(track: Mp4Track, file: string): Promise<void> {
  if (typeof VideoDecoder === 'undefined' || typeof EncodedVideoChunk === 'undefined') {
    throw new StudyError('unsupported', 'This browser can’t decode video frames in the page (WebCodecs is missing).', file, HINT);
  }
  if (typeof OffscreenCanvas === 'undefined') {
    throw new StudyError('unsupported', 'This browser has no OffscreenCanvas, which the preview needs.', file, HINT);
  }
  let supported = false;
  try {
    supported = (await VideoDecoder.isConfigSupported(decoderConfig(track))).supported === true;
  } catch {
    supported = false;
  }
  if (!supported) {
    throw new StudyError('unsupported', `This browser can’t decode this clip’s video (${track.codec}, ${track.width}×${track.height}).`, file, HINT);
  }
}

/** Where decoded frames are drawn before being snapshotted: full size, or thumbnail size. */
interface Target {
  readonly canvas: OffscreenCanvas;
  readonly ctx: OffscreenCanvasRenderingContext2D;
}

interface Job {
  readonly emit: (frame: Frames, bitmap: ImageBitmap) => void;
  readonly target: Target;
  error: unknown;
}

function makeTarget(width: number, height: number, file: string): Target {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new StudyError('decode', 'Could not create a 2D canvas for decoding.', file);
  return { canvas, ctx };
}

export class ClipDecoder implements GopSource<ImageBitmap> {
  readonly width: number;
  readonly height: number;
  private decoder: VideoDecoder | null = null;
  private job: Job | null = null;
  private readonly full: Target;
  private readonly thumb: Target;

  constructor(
    readonly sourceId: string,
    private readonly file: string,
    private readonly bytes: Uint8Array,
    private readonly track: Mp4Track,
  ) {
    this.width = track.width;
    this.height = track.height;
    this.full = makeTarget(track.width, track.height, file);
    this.thumb = makeTarget(THUMBS.width, THUMBS.height, file);
  }

  gopOf(frame: Frames): number {
    return gopOf(this.track, frame);
  }

  /** Decode one GOP at full size. */
  decodeGop(gop: number, emit: (frame: Frames, bitmap: ImageBitmap) => void): Promise<void> {
    const { start, end } = gopRange(this.track, gop);
    return this.withRetry(gop, () => this.run(start, end, emit, this.full));
  }

  /** Decode only a GOP's keyframe (it needs no other frames), at thumbnail size. */
  async decodeThumb(gop: number): Promise<ImageBitmap> {
    const { start } = gopRange(this.track, gop);
    let out: ImageBitmap | null = null;
    await this.withRetry(gop, () =>
      this.run(start, start + 1, (_f, bitmap) => {
        out?.close();
        out = bitmap;
      }, this.thumb),
    );
    if (!out) throw new StudyError('decode', `The browser produced no thumbnail for ${this.file}.`, this.file);
    return out;
  }

  /** After a decoder error, start a fresh decoder and try once more. */
  private async withRetry(gop: number, attempt: () => Promise<void>): Promise<void> {
    try {
      await attempt();
    } catch (first) {
      this.close();
      console.warn(`[decode] ${this.file}: retrying keyframe group ${gop} after`, first);
      try {
        await attempt();
      } catch (e) {
        this.close();
        throw new StudyError('decode', `The browser could not decode ${this.file} (${e instanceof Error ? e.message : String(e)}).`, this.file, 'Re-generate the clips with the clip scripts, then Retry.');
      }
    }
  }

  close(): void {
    if (this.decoder && this.decoder.state !== 'closed') this.decoder.close();
    this.decoder = null;
    this.job = null;
  }

  private ensureDecoder(): VideoDecoder {
    if (this.decoder && this.decoder.state === 'configured') return this.decoder;
    this.close();
    const decoder = new VideoDecoder({
      output: (frame) => this.onOutput(frame),
      error: (e) => {
        if (this.job) this.job.error = e;
      },
    });
    decoder.configure(decoderConfig(this.track));
    this.decoder = decoder;
    return decoder;
  }

  /** Decode frames [start, end), which must begin on a keyframe, then flush. */
  private async run(start: Frames, end: Frames, emit: Job['emit'], target: Target): Promise<void> {
    const decoder = this.ensureDecoder();
    const job: Job = { emit, target, error: null };
    this.job = job;
    try {
      for (let i = start; i < end; i++) {
        const s = this.track.samples[i]!;
        decoder.decode(
          new EncodedVideoChunk({
            type: s.key ? 'key' : 'delta',
            timestamp: Math.round(i * US_PER_FRAME),
            duration: Math.round(US_PER_FRAME),
            data: this.bytes.subarray(s.offset, s.offset + s.size),
          }),
        );
      }
      await decoder.flush();
    } finally {
      if (this.job === job) this.job = null;
    }
    if (job.error) throw job.error;
  }

  private onOutput(frame: VideoFrame) {
    const job = this.job;
    try {
      if (!job) return;
      const index = Math.round(frame.timestamp / US_PER_FRAME);
      const { canvas, ctx } = job.target;
      ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
      job.emit(index, canvas.transferToImageBitmap());
    } catch (e) {
      if (job) job.error = e;
    } finally {
      frame.close();
    }
  }
}
