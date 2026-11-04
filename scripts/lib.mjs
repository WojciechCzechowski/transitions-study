// Shared helpers for the footage scripts. Plain Node, no dependencies.
// Requires `ffmpeg` and `ffprobe` on PATH.
import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FPS = 30;
/** Size of the synthetic clips (make-clips.mjs). normalize-clips.mjs defaults to 1280×720 (--size). */
export const WIDTH = 960;
export const HEIGHT = 540;
export const FRAMES = 120;

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CLIPS_DIR = join(ROOT, 'public', 'clips');

/**
 * Encoder settings shared by both scripts: H.264, constant 30 fps, a keyframe
 * every 10 frames and no B-frames. The app decodes one keyframe group at a
 * time with WebCodecs and reads frames in file order, so both matter.
 * CRF 20 keeps 720p downloads modest with no visible loss in the preview.
 */
export const ENCODE_ARGS = [
  '-an',
  '-c:v', 'libx264',
  '-preset', 'medium',
  '-crf', '20',
  '-g', '10',
  '-keyint_min', '10',
  '-bf', '0',
  '-pix_fmt', 'yuv420p',
  '-colorspace', 'bt709',
  '-color_primaries', 'bt709',
  '-color_trc', 'bt709',
  '-movflags', '+faststart',
];

export function ensureClipsDir() {
  mkdirSync(CLIPS_DIR, { recursive: true });
}

/** Spawn ffmpeg and resolve when it exits cleanly. */
export function runFfmpeg(args, { stdin = 'ignore' } = {}) {
  const child = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], {
    stdio: [stdin, 'inherit', 'inherit'],
  });
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`)),
    );
  });
  return { child, done };
}

/** Count decoded frames and read the stream's frame rate with ffprobe. */
export function probe(file) {
  const out = execFileSync(
    'ffprobe',
    [
      '-v', 'error',
      '-count_frames',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=nb_read_frames,r_frame_rate,width,height',
      '-of', 'json',
      file,
    ],
    { encoding: 'utf8' },
  );
  const stream = JSON.parse(out).streams?.[0];
  if (!stream) throw new Error(`No video stream in ${file}`);
  return {
    frames: Number(stream.nb_read_frames),
    rate: stream.r_frame_rate,
    width: stream.width,
    height: stream.height,
  };
}

/**
 * Write public/clips/manifest.json. The app reads this to learn each clip's
 * file name and frame count; in/out points live in src/config/study.config.ts.
 */
export function writeManifest(clips, source, extra = {}) {
  const manifest = {
    fps: FPS,
    source,
    ...extra,
    clips: clips.map((c) => {
      const p = probe(join(CLIPS_DIR, c.file));
      if (p.rate !== `${FPS}/1`) {
        throw new Error(`${c.file}: expected ${FPS}/1 fps, got ${p.rate}`);
      }
      return { id: c.id, label: c.label, file: c.file, frames: p.frames, width: p.width, height: p.height };
    }),
  };
  writeFileSync(join(CLIPS_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
