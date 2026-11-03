// Generates two synthetic, visually distinct clips with the source frame
// index burned in (e.g. "A 047"), so frame accuracy can be checked by eye.
//
//   node scripts/make-clips.mjs
//
// Frames are drawn procedurally in Node and piped as raw RGB into ffmpeg.
// The local ffmpeg build has no drawtext, so text uses a tiny bitmap font.
import { join } from 'node:path';
import {
  CLIPS_DIR, ENCODE_ARGS, FPS, FRAMES, HEIGHT, WIDTH,
  ensureClipsDir, runFfmpeg, writeManifest,
} from './lib.mjs';

// 5×7 bitmap glyphs, one string per row.
const GLYPHS = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

function setPx(buf, x, y, r, g, b) {
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return;
  const i = (y * WIDTH + x) * 3;
  buf[i] = r;
  buf[i + 1] = g;
  buf[i + 2] = b;
}

function fillRect(buf, x0, y0, w, h, r, g, b, alpha = 1) {
  for (let y = Math.max(0, y0); y < Math.min(HEIGHT, y0 + h); y++) {
    for (let x = Math.max(0, x0); x < Math.min(WIDTH, x0 + w); x++) {
      const i = (y * WIDTH + x) * 3;
      buf[i] = lerp(buf[i], r, alpha);
      buf[i + 1] = lerp(buf[i + 1], g, alpha);
      buf[i + 2] = lerp(buf[i + 2], b, alpha);
    }
  }
}

function drawText(buf, text, x0, y0, scale, rgb) {
  let x = x0;
  for (const ch of text) {
    const glyph = GLYPHS[ch];
    if (!glyph) throw new Error(`No glyph for "${ch}"`);
    for (let gy = 0; gy < 7; gy++) {
      for (let gx = 0; gx < 5; gx++) {
        if (glyph[gy][gx] === '1') fillRect(buf, x + gx * scale, y0 + gy * scale, scale, scale, ...rgb);
      }
    }
    x += 6 * scale;
  }
}

/** Overlays shared by both clips: frame label plate and source position bar. */
function drawOverlays(buf, letter, f) {
  const label = `${letter} ${String(f).padStart(3, '0')}`;
  const scale = 10;
  const textW = label.length * 6 * scale - scale;
  fillRect(buf, 20, 404, textW + 32, 7 * scale + 32, 12, 12, 14, 0.78);
  drawText(buf, label, 36, 420, scale, [245, 245, 245]);

  // Source position bar, with a tick every second.
  const barX = 20, barY = 512, barW = WIDTH - 40, barH = 10;
  fillRect(buf, barX, barY, barW, barH, 12, 12, 14, 0.7);
  fillRect(buf, barX, barY, Math.round((barW * (f + 1)) / FRAMES), barH, 235, 235, 235, 0.9);
  for (let s = 1; s < FRAMES / FPS; s++) {
    fillRect(buf, barX + Math.round((barW * s * FPS) / FRAMES), barY - 4, 2, barH + 8, 20, 20, 20, 1);
  }
}

/** Clip A: warm gradient, scrolling diagonal stripes, a disc travelling left to right. */
function drawClipA(buf, f) {
  const discX = lerp(140, WIDTH - 140, f / (FRAMES - 1));
  const discY = 230 + Math.sin(f * 0.08) * 30;
  const discR = 110;
  for (let y = 0; y < HEIGHT; y++) {
    const ty = y / (HEIGHT - 1);
    const ground = y > 380;
    let r = ground ? lerp(120, 70, (y - 380) / 160) : lerp(250, 196, ty);
    let g = ground ? lerp(40, 20, (y - 380) / 160) : lerp(176, 70, ty);
    let b = ground ? lerp(90, 60, (y - 380) / 160) : lerp(70, 120, ty);
    for (let x = 0; x < WIDTH; x++) {
      const stripe = ((x + y + f * 6) % 80) < 40 ? 1.1 : 0.92;
      let rr = r * stripe, gg = g * stripe, bb = b * stripe;
      const d = Math.hypot(x - discX, y - discY);
      const disc = 1 - smoothstep(discR - 2, discR + 2, d);
      if (disc > 0) {
        rr = lerp(rr, 255, disc);
        gg = lerp(gg, 240, disc);
        bb = lerp(bb, 212, disc);
      }
      const i = (y * WIDTH + x) * 3;
      buf[i] = Math.min(255, rr);
      buf[i + 1] = Math.min(255, gg);
      buf[i + 2] = Math.min(255, bb);
    }
  }
  // Horizon line.
  fillRect(buf, 0, 378, WIDTH, 4, 255, 230, 200, 0.8);
  drawOverlays(buf, 'A', f);
}

/** Clip B: cool gradient, a grid, expanding rings, a rotating square outline. */
function drawClipB(buf, f) {
  const ringX = 640, ringY = 220;
  const sqX = 290, sqY = 250, half = 100, edge = 10;
  const angle = f * 0.03;
  const ca = Math.cos(angle), sa = Math.sin(angle);
  for (let y = 0; y < HEIGHT; y++) {
    const ty = y / (HEIGHT - 1);
    const r = lerp(40, 18, ty), g = lerp(168, 32, ty), b = lerp(180, 86, ty);
    for (let x = 0; x < WIDTH; x++) {
      let rr = r, gg = g, bb = b;
      if (x % 60 === 0 || y % 60 === 0) {
        rr += 18; gg += 22; bb += 26;
      }
      const d = Math.hypot(x - ringX, y - ringY);
      const ring = smoothstep(0.55, 0.75, Math.sin(d * 0.07 - f * 0.25)) * (1 - smoothstep(120, 420, d));
      rr = lerp(rr, 200, ring * 0.6);
      gg = lerp(gg, 245, ring * 0.6);
      bb = lerp(bb, 255, ring * 0.6);
      // Rotating square outline.
      const lx = (x - sqX) * ca + (y - sqY) * sa;
      const ly = -(x - sqX) * sa + (y - sqY) * ca;
      const m = Math.max(Math.abs(lx), Math.abs(ly));
      if (m <= half && m >= half - edge) {
        rr = 232; gg = 246; bb = 255;
      }
      const i = (y * WIDTH + x) * 3;
      buf[i] = Math.min(255, rr);
      buf[i + 1] = Math.min(255, gg);
      buf[i + 2] = Math.min(255, bb);
    }
  }
  drawOverlays(buf, 'B', f);
}

async function encode(file, draw) {
  const { child, done } = runFfmpeg(
    [
      '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${WIDTH}x${HEIGHT}`, '-r', String(FPS), '-i', '-',
      '-frames:v', String(FRAMES),
      '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
      ...ENCODE_ARGS,
      join(CLIPS_DIR, file),
    ],
    { stdin: 'pipe' },
  );
  for (let f = 0; f < FRAMES; f++) {
    const buf = Buffer.alloc(WIDTH * HEIGHT * 3);
    draw(buf, f);
    if (!child.stdin.write(buf)) {
      await new Promise((resolve) => child.stdin.once('drain', resolve));
    }
  }
  child.stdin.end();
  await done;
}

ensureClipsDir();
const clips = [
  { id: 'a', label: 'Clip A', file: 'clip-a.mp4', draw: drawClipA },
  { id: 'b', label: 'Clip B', file: 'clip-b.mp4', draw: drawClipB },
];
for (const clip of clips) {
  process.stdout.write(`Encoding ${clip.file}… `);
  await encode(clip.file, clip.draw);
  process.stdout.write('done\n');
}
const manifest = writeManifest(clips, 'synthetic');
console.log(JSON.stringify(manifest, null, 2));
