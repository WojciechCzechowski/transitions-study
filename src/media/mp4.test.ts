import { describe, expect, it } from 'vitest';
import { TINY_PACKETS, tinyMp4 } from './__fixtures__/tinyMp4';
import { StudyError } from './errors';
import { gopOf, gopRange, parseMp4 } from './mp4';

describe('parseMp4', () => {
  const bytes = tinyMp4();
  const track = parseMp4(bytes, 'tiny.mp4');

  it('reads size, codec and the avcC record', () => {
    expect(track).toMatchObject({ width: 64, height: 36, codec: 'avc1.64000a' });
    expect(track.description[0]).toBe(1); // configurationVersion
    expect(track.timescale / track.frameDelta).toBe(30);
  });

  it('places every frame where ffprobe does, with keyframes every 10 frames', () => {
    expect(track.samples).toHaveLength(TINY_PACKETS.length);
    track.samples.forEach((s, i) => {
      const [size, offset, key] = TINY_PACKETS[i]!;
      expect({ i, size: s.size, offset: s.offset, key: s.key }).toEqual({ i, size, offset, key });
    });
    expect(track.keyframes).toEqual([0, 10, 20]);
  });

  it('maps frames to keyframe groups', () => {
    expect([0, 9, 10, 19, 20, 24].map((f) => gopOf(track, f))).toEqual([0, 0, 1, 1, 2, 2]);
    expect(gopRange(track, 0)).toEqual({ start: 0, end: 10 });
    expect(gopRange(track, 2)).toEqual({ start: 20, end: 25 });
  });

  it('explains files it cannot read', () => {
    expect(() => parseMp4(new Uint8Array([0, 0, 0, 8, 0x66, 0x72, 0x65, 0x65]), 'x.mp4')).toThrow(/no "moov" box/);
    const cut = bytes.slice(0, 600);
    expect(() => parseMp4(cut, 'cut.mp4')).toThrow(StudyError);
  });
});
