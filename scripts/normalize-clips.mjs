// Converts two of your own videos into the format the study expects:
// 30 fps constant frame rate, 960×540 (letterboxed), short GOP, no audio,
// trimmed to 120 frames. Writes public/clips/clip-a.mp4, clip-b.mp4 and
// manifest.json, replacing the synthetic clips.
//
//   node scripts/normalize-clips.mjs <clip-a> <clip-b> [--start 2.5] [--start-b 0] [--frames 120]
//
// --start applies to both inputs unless --start-b is given. If a source is
// shorter than the in/out ranges in src/config/study.config.ts need, the app
// shows an error explaining which clip is too short.
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { CLIPS_DIR, ENCODE_ARGS, FPS, FRAMES, HEIGHT, WIDTH, ensureClipsDir, runFfmpeg, writeManifest } from './lib.mjs';

function parseArgs(argv) {
  const files = [];
  const opts = { start: 0, startB: undefined, frames: FRAMES };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--start') opts.start = Number(argv[++i]);
    else if (a === '--start-b') opts.startB = Number(argv[++i]);
    else if (a === '--frames') opts.frames = Number(argv[++i]);
    else files.push(a);
  }
  if (files.length !== 2) {
    console.error('Usage: node scripts/normalize-clips.mjs <clip-a> <clip-b> [--start s] [--start-b s] [--frames n]');
    process.exit(1);
  }
  for (const n of [opts.start, opts.startB ?? 0, opts.frames]) {
    if (!Number.isFinite(n) || n < 0) {
      console.error('--start, --start-b and --frames must be non-negative numbers');
      process.exit(1);
    }
  }
  return { files: files.map((f) => resolve(f)), opts };
}

const { files, opts } = parseArgs(process.argv.slice(2));
for (const f of files) {
  if (!existsSync(f)) {
    console.error(`Not found: ${f}`);
    process.exit(1);
  }
}

ensureClipsDir();
const clips = [
  { id: 'a', label: 'Clip A', file: 'clip-a.mp4', input: files[0], start: opts.start },
  { id: 'b', label: 'Clip B', file: 'clip-b.mp4', input: files[1], start: opts.startB ?? opts.start },
];

for (const clip of clips) {
  process.stdout.write(`Normalising ${clip.input} → ${clip.file}… `);
  const { done } = runFfmpeg([
    '-ss', String(clip.start),
    '-i', clip.input,
    '-vf',
    [
      `fps=${FPS}`,
      `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease`,
      `pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black`,
      'setsar=1',
      'scale=out_color_matrix=bt709:out_range=tv',
      'format=yuv420p',
    ].join(','),
    '-frames:v', String(opts.frames),
    '-fps_mode', 'cfr',
    ...ENCODE_ARGS,
    join(CLIPS_DIR, clip.file),
  ]);
  await done;
  process.stdout.write('done\n');
}

const manifest = writeManifest(clips, 'normalized');
for (const c of manifest.clips) {
  if (c.frames < opts.frames) {
    console.warn(`Warning: ${c.file} has only ${c.frames} frames (asked for ${opts.frames}). The source is too short.`);
  }
}
console.log(JSON.stringify(manifest, null, 2));
