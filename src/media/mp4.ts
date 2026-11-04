/**
 * A minimal MP4 reader for the clips our scripts produce: one H.264 video
 * track, no B-frames (decode order = display order), moov before mdat.
 * It reads only the sample table, which is all WebCodecs needs: where each
 * frame's bytes are, which frames are keyframes, and the avcC record that
 * configures the decoder.
 */
import type { Frames } from '../model/time';
import { StudyError } from './errors';

export interface Sample {
  /** Byte offset of the frame in the file. */
  readonly offset: number;
  readonly size: number;
  readonly key: boolean;
}

export interface Mp4Track {
  /** WebCodecs codec string, e.g. "avc1.64001f". */
  readonly codec: string;
  /** The avcC record, passed as VideoDecoderConfig.description. */
  readonly description: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly timescale: number;
  /** Duration of one frame in `timescale` units (the stream is constant rate). */
  readonly frameDelta: number;
  /** One per frame, in display order. */
  readonly samples: readonly Sample[];
  /** Frame indices of the keyframes, ascending; the first is always 0. */
  readonly keyframes: readonly Frames[];
}

const HINT = 'Re-generate the clips with `npm run clips` or `npm run clips:normalize`, then Retry.';

interface Box {
  readonly type: string;
  /** Payload start (after the header) and end, as absolute offsets. */
  readonly start: number;
  readonly end: number;
}

export function parseMp4(bytes: Uint8Array, file = 'clip'): Mp4Track {
  const fail = (why: string): never => {
    throw new StudyError('decode', `${file} could not be read: ${why}.`, file, HINT);
  };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u8 = (o: number) => (o < bytes.length ? bytes[o]! : fail('the file ends early'));
  const u16 = (o: number) => (o + 2 <= bytes.length ? view.getUint16(o) : fail('the file ends early'));
  const u32 = (o: number) => (o + 4 <= bytes.length ? view.getUint32(o) : fail('the file ends early'));
  const u64 = (o: number) => {
    const hi = u32(o);
    const lo = u32(o + 4);
    const n = hi * 2 ** 32 + lo;
    return Number.isSafeInteger(n) ? n : fail('a 64-bit offset is too large');
  };
  const fourcc = (o: number) => String.fromCharCode(u8(o), u8(o + 1), u8(o + 2), u8(o + 3));

  /** Child boxes of the range [start, end). */
  const children = (start: number, end: number): Box[] => {
    const out: Box[] = [];
    let o = start;
    while (o + 8 <= end) {
      let size = u32(o);
      const type = fourcc(o + 4);
      let header = 8;
      if (size === 1) {
        size = u64(o + 8);
        header = 16;
      } else if (size === 0) {
        size = end - o;
      }
      if (size < header || o + size > end) fail(`the "${type}" box has a bad size`);
      out.push({ type, start: o + header, end: o + size });
      o += size;
    }
    return out;
  };
  const child = (parent: Box, type: string) => children(parent.start, parent.end).find((b) => b.type === type);
  const need = (parent: Box, type: string) => child(parent, type) ?? fail(`no "${type}" box`);

  const top = children(0, bytes.length);
  const moov = top.find((b) => b.type === 'moov') ?? fail('no "moov" box (is it an MP4 file?)');

  const video = children(moov.start, moov.end)
    .filter((b) => b.type === 'trak')
    .map((trak) => need(trak, 'mdia'))
    .find((mdia) => {
      const hdlr = need(mdia, 'hdlr');
      return fourcc(hdlr.start + 8) === 'vide';
    });
  if (!video) return fail('no video track');
  const mdia = video;

  const mdhd = need(mdia, 'mdhd');
  const timescale = u8(mdhd.start) === 1 ? u32(mdhd.start + 20) : u32(mdhd.start + 12);
  const stbl = need(need(mdia, 'minf'), 'stbl');

  // stsd → avc1/avc3 sample entry → avcC
  const stsd = need(stbl, 'stsd');
  const entry = children(stsd.start + 8, stsd.end)[0] ?? fail('no sample description');
  if (entry.type !== 'avc1' && entry.type !== 'avc3') fail(`the video codec is "${entry.type}", not H.264`);
  const width = u16(entry.start + 24);
  const height = u16(entry.start + 26);
  const avcC = children(entry.start + 78, entry.end).find((b) => b.type === 'avcC') ?? fail('no "avcC" record');
  const description = bytes.slice(avcC.start, avcC.end);
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  const codec = `avc1.${hex(u8(avcC.start + 1))}${hex(u8(avcC.start + 2))}${hex(u8(avcC.start + 3))}`;

  if (child(stbl, 'ctts')) fail('frames are reordered (B-frames), which this study does not support');

  // stts: one entry means constant frame rate.
  const stts = need(stbl, 'stts');
  const sttsCount = u32(stts.start + 4);
  const deltas = new Set<number>();
  for (let i = 0; i < sttsCount; i++) {
    const n = u32(stts.start + 8 + i * 8);
    const d = u32(stts.start + 12 + i * 8);
    // The last frame's duration may differ; ignore single-sample runs at the end.
    if (n > 1 || i < sttsCount - 1) deltas.add(d);
  }
  if (deltas.size > 1) fail('the frame rate is not constant');
  const frameDelta = [...deltas][0] ?? u32(stts.start + 12);

  // stsz: sample sizes
  const stsz = need(stbl, 'stsz');
  const fixedSize = u32(stsz.start + 4);
  const count = u32(stsz.start + 8);
  if (count === 0) fail('the video track has no frames');
  const sizes = new Array<number>(count);
  for (let i = 0; i < count; i++) sizes[i] = fixedSize || u32(stsz.start + 12 + i * 4);

  // stco / co64: chunk offsets
  const stco = child(stbl, 'stco');
  const co64 = child(stbl, 'co64');
  const chunkOffsets: number[] = [];
  if (stco) {
    const n = u32(stco.start + 4);
    for (let i = 0; i < n; i++) chunkOffsets.push(u32(stco.start + 8 + i * 4));
  } else if (co64) {
    const n = u32(co64.start + 4);
    for (let i = 0; i < n; i++) chunkOffsets.push(u64(co64.start + 8 + i * 8));
  } else {
    fail('no chunk offsets');
  }

  // stsc: samples per chunk, as runs starting at first_chunk (1-based)
  const stsc = need(stbl, 'stsc');
  const runs: { first: number; perChunk: number }[] = [];
  const stscCount = u32(stsc.start + 4);
  for (let i = 0; i < stscCount; i++) {
    runs.push({ first: u32(stsc.start + 8 + i * 12), perChunk: u32(stsc.start + 12 + i * 12) });
  }
  if (runs.length === 0) fail('no sample-to-chunk table');

  // stss: keyframes (1-based). Absent means every frame is a keyframe.
  const stss = child(stbl, 'stss');
  const keySet = new Set<number>();
  if (stss) {
    const n = u32(stss.start + 4);
    for (let i = 0; i < n; i++) keySet.add(u32(stss.start + 8 + i * 4) - 1);
  }

  const samples: Sample[] = [];
  let s = 0;
  for (let c = 0; c < chunkOffsets.length && s < count; c++) {
    const chunkNo = c + 1;
    let run = runs[0]!;
    for (const r of runs) if (r.first <= chunkNo) run = r;
    let offset = chunkOffsets[c]!;
    for (let k = 0; k < run.perChunk && s < count; k++, s++) {
      const size = sizes[s]!;
      if (offset + size > bytes.length) fail('a frame lies past the end of the file');
      samples.push({ offset, size, key: !stss || keySet.has(s) });
      offset += size;
    }
  }
  if (samples.length !== count) fail(`the sample table lists ${count} frames but places ${samples.length}`);
  if (!samples[0]!.key) fail('the first frame is not a keyframe');

  const keyframes = samples.flatMap((x, i) => (x.key ? [i] : []));
  return { codec, description, width, height, timescale, frameDelta, samples, keyframes };
}

/** Index of the keyframe group (GOP) that contains `frame`. */
export function gopOf(track: Pick<Mp4Track, 'keyframes'>, frame: Frames): number {
  const k = track.keyframes;
  let lo = 0;
  let hi = k.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (k[mid]! <= frame) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Half-open frame range [start, end) of a GOP. */
export function gopRange(track: Pick<Mp4Track, 'keyframes' | 'samples'>, gop: number): { start: Frames; end: Frames } {
  const start = track.keyframes[gop] ?? 0;
  const end = track.keyframes[gop + 1] ?? track.samples.length;
  return { start, end };
}
