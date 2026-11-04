# Transition study

An unofficial interaction study of transitions in a very simple browser video editor: skim or play prepared clips in the Library, mark in and out, drag or insert them onto a magnetic V1 track, trim them, split them at the playhead and put transitions on any cut. React, TypeScript, Vite, Vitest and WebGL2. No backend.

The Library is the clips listed in `public/clips/manifest.json` (at least two; the starting timeline uses the first two). The app downloads each MP4, reads its frame table, and decodes frames on demand with WebCodecs, one keyframe group (10 frames) at a time, into a cache capped at 320 MB (`DECODE` in `src/config/study.config.ts`). Only the frames around the playhead, the playback lookahead and the transition preview loop are kept, so memory does not grow with clip length and every frame is still exact. If decoding falls behind, the preview shows the nearest decoded frame and playback keeps time; on pause the console says how many frames were stand-ins. It needs a browser with WebCodecs (current Chrome, Edge, Safari or Firefox).

```bash
npm install
npm run clips      # generate the two synthetic clips into public/clips (needs ffmpeg)
npm run dev
```

To use your own footage instead (30 fps CFR, 1280×720, a keyframe every 10 frames, no B-frames, 120 frames by default), pass two or more videos, or a folder of them:

```bash
npm run clips:normalize -- path/to/a.mov path/to/b.mov path/to/c.mp4 --start 2
npm run clips:normalize -- ~/Movies/study --starts 2,0,5 --frames all
```

Library order follows the order given (a folder is sorted by name), the starting timeline uses the first two, and each clip is labelled with its file name. `--start` sets where every clip begins in its source; `--starts` sets it per clip. `--frames all` keeps each video to its end (length only costs download size), and `--size 1920x1080` changes the output size. The run replaces all previous clips in `public/clips`.

`public/clips/` is ignored by git: clips are made locally and not redistributed through the repo. A fresh clone runs `npm run clips` (or `clips:normalize`) before `npm run dev`. `--credit "Footage: Pexels" --credit-url https://www.pexels.com` adds a footage credit that the app shows in the top bar.

## Footage

The demo uses three videos from [Pexels](https://www.pexels.com), free to use under the [Pexels license](https://www.pexels.com/license/) (attribution optional, given here anyway). They were downloaded on 2026-11-04 and re-encoded with `clips:normalize` (1280×720, 30 fps, no audio). The files are not in this repo.

| Clip | Author |
| --- | --- |
| smile | [Eclipse Chasers](https://www.pexels.com/@eclipse-chasers-716719984) |
| catch, river | [Michal Petráš](https://www.pexels.com/@michal-petras-2152077115) |

## Deploying

The clips are not committed, so a host that builds from the git repo has none. There are two ways around that.

**Clips hosted elsewhere (git deploys work).** Put `manifest.json` and the clips in a bucket (for example Cloudflare R2), allow CORS `GET` from the site's origin, and set `VITE_CLIPS_BASE_URL` to the bucket's URL in the build environment. Without the variable the app loads from `/clips/` on its own origin.

**Upload a local build.** Build where the clips are: `npm run build` copies `public/clips` into `dist`, then upload it, for example `npx wrangler pages deploy dist` for Cloudflare Pages. Pages limits each file to 25 MiB, so keep each clip under that (shorter clips, or a higher CRF in `scripts/lib.mjs`).

## Where things are

| Area | File |
| --- | --- |
| Preset values, Feel endpoints, preview loop padding | `src/config/transitions.config.ts` |
| Starting timeline, decoded-frame cache | `src/config/study.config.ts` |
| Timeline model (clips, cuts, per-cut limits, frame mapping) | `src/model/timeline.ts` |
| Insert / move / delete / split / trim, and per-cut transition ops | `src/model/ops.ts`, `src/model/feel.ts` |
| Undo history with gestures | `src/model/history.ts` |
| Which source frames the preview needs now (playhead, lookahead, preview loop) | `src/model/demand.ts` |
| Insertion points, ruler ticks, zoom | `src/model/timelineView.ts` |
| MP4 frame table reader, WebCodecs decoder per clip | `src/media/mp4.ts`, `src/media/ClipDecoder.ts` |
| Decode scheduling and the capped frame cache | `src/media/FrameFeeder.ts`, `src/media/FrameStore.ts` |
| WebGL2 renderer and one shader per transition | `src/render/` |
| Single rAF loop for playback and previews | `src/playback/PreviewController.ts` |
| Workspace shell: top bar, resizable sidebar / preview / timeline | `src/ui/Shell.tsx`, `src/ui/Splitter.tsx` |
| Pane size limits, splitter keys, sidebar level | `src/model/layout.ts` |
| Sidebar: Library tab, Transitions tab (level 1 picker, level 2 editor) | `src/ui/LibraryPanel.tsx`, `src/ui/TransitionsPanel.tsx`, `src/ui/Gallery.tsx`, `src/ui/Inspector.tsx` |
| Timeline: clips with trim grips, cuts, transitions | `src/ui/Timeline.tsx`, `src/ui/ClipItem.tsx`, `src/ui/CutZone.tsx`, `src/ui/TransitionItem.tsx` |

All model times are integer frames at 30 fps. Library clips go onto the timeline in full (or their marked part). Transitions are centred on a cut and always an even number of frames long, so each half needs that many frames of handle past the cut. Where a clip's handle is short, applying or lengthening a transition trims that clip just enough to make one: the frames it gives up show inside the transition, and later clips shift left (one undo step). Shortening or removing the transition leaves the clips as they are. A clip's length is shared by the transitions at both of its ends, and trimming into a transition's handle shrinks it down to 2 frames, where the trim stops.

```bash
npm run typecheck
npm test
npm run build
```
