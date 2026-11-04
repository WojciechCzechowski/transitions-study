// Converts your own videos into the format the study expects:
// 30 fps constant frame rate, 960×540 (letterboxed), short GOP, no audio,
// trimmed to 120 frames. Writes public/clips/clip-a.mp4, clip-b.mp4, … and
// manifest.json, replacing whatever clips were there before.
//
//   node scripts/normalize-clips.mjs <video or folder>... [--start 2.5] [--starts 2,0,5] [--frames 120]
//
// Pass at least two videos. A folder adds every video in it, sorted by name.
// Library order follows the order given; the starting timeline uses the
// first two. Each clip is labelled with its source file name.
//
// --start applies to every input. --starts sets a start per input, in order;
// inputs past the end of that list fall back to --start. If one of the first
// two sources is shorter than the in/out ranges in src/config/study.config.ts
// need, the app shows an error explaining which clip is too short.
import { basename, extname, join, resolve } from 'node:path';
import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { CLIPS_DIR, ENCODE_ARGS, FPS, FRAMES, HEIGHT, WIDTH, ensureClipsDir, runFfmpeg, writeManifest } from './lib.mjs';

const VIDEO_EXT = new Set(['.mov', '.mp4', '.m4v', '.mkv', '.webm', '.avi', '.mts', '.m2ts']);
const USAGE =
  'Usage: npm run clips:normalize -- <video or folder>... [--start s] [--starts s1,s2,…] [--frames n]';

const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

const isNonNegative = (n) => Number.isFinite(n) && n >= 0;

function parseArgs(argv) {
  const inputs = [];
  const opts = { start: 0, starts: [], frames: FRAMES };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--start') opts.start = Number(argv[++i]);
    else if (a === '--starts') opts.starts = String(argv[++i] ?? '').split(',').map((s) => Number(s.trim()));
    else if (a === '--frames') opts.frames = Number(argv[++i]);
    else if (a.startsWith('--')) fail(`Unknown option ${a}\n${USAGE}`);
    else inputs.push(a);
  }
  if (![opts.start, opts.frames, ...opts.starts].every(isNonNegative)) {
    fail('--start, --starts and --frames must be non-negative numbers');
  }
  return { inputs, opts };
}

/** Expand folders into the video files they contain, sorted by name. */
function expandInputs(inputs) {
  const files = [];
  for (const input of inputs) {
    const path = resolve(input);
    if (!existsSync(path)) fail(`Not found: ${path}`);
    if (statSync(path).isDirectory()) {
      const videos = readdirSync(path)
        .filter((f) => !f.startsWith('.') && VIDEO_EXT.has(extname(f).toLowerCase()))
        .sort((x, y) => x.localeCompare(y, undefined, { numeric: true }))
        .map((f) => join(path, f));
      if (videos.length === 0) console.warn(`Warning: no videos found in ${path}`);
      files.push(...videos);
    } else {
      files.push(path);
    }
  }
  return files;
}

/** a, b, …, z, then 27, 28, … */
const clipId = (i) => (i < 26 ? String.fromCharCode(97 + i) : String(i + 1));

const { inputs, opts } = parseArgs(process.argv.slice(2));
const files = expandInputs(inputs);
if (files.length < 2) fail(`Need at least two videos, got ${files.length}.\n${USAGE}`);
if (opts.starts.length > files.length) {
  console.warn(`Warning: --starts has ${opts.starts.length} values for ${files.length} videos; the extra ones are ignored.`);
}

ensureClipsDir();
const clips = files.map((input, i) => {
  const id = clipId(i);
  return {
    id,
    label: basename(input, extname(input)),
    file: `clip-${id}.mp4`,
    input,
    start: opts.starts[i] ?? opts.start,
  };
});

for (const clip of clips) {
  process.stdout.write(`Normalising ${clip.input} (from ${clip.start}s) → ${clip.file}… `);
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

// Drop clips left over from an earlier, longer run so the folder matches the manifest.
const keep = new Set(clips.map((c) => c.file));
for (const f of readdirSync(CLIPS_DIR)) {
  if (/^clip-[a-z0-9]+\.mp4$/.test(f) && !keep.has(f)) {
    unlinkSync(join(CLIPS_DIR, f));
    console.log(`Removed old ${f}`);
  }
}

const manifest = writeManifest(clips, 'normalized');
for (const c of manifest.clips) {
  if (c.frames < opts.frames) {
    console.warn(`Warning: ${c.file} (${c.label}) has only ${c.frames} frames (asked for ${opts.frames}). The source is too short after its start point.`);
  }
}
console.log(`\n${manifest.clips.length} clips written to public/clips:`);
for (const c of manifest.clips) console.log(`  ${c.id}  ${c.label}  ${c.frames} frames`);
