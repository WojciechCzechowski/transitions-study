# Transition study

An unofficial interaction study of transitions in a very simple browser video editor: drag prepared clips from the Library onto a magnetic V1 track, trim them, split them at the playhead and put transitions on any cut. React, TypeScript, Vite, Vitest and WebGL2. No backend.

The Library is the clips listed in `public/clips/manifest.json` (at least two; the starting timeline uses the first two). Every frame of every library clip is pre-decoded once at the largest size that fits the memory cap in `src/config/study.config.ts`, so playback, scrubbing and transitions are frame-accurate from memory. Many long clips lower the decode resolution; the console logs the chosen size.

```bash
npm install
npm run clips      # generate the two synthetic clips into public/clips (needs ffmpeg)
npm run dev
```

To use your own footage instead (30 fps CFR, 960×540, short GOP, 120 frames):

```bash
npm run clips:normalize -- path/to/a.mov path/to/b.mov --start 2
```

## Where things are

| Area | File |
| --- | --- |
| Preset values, Feel endpoints, preview loop padding | `src/config/transitions.config.ts` |
| Starting timeline, Library insert handles, decode memory cap | `src/config/study.config.ts` |
| Timeline model (clips, cuts, per-cut limits, frame mapping) | `src/model/timeline.ts` |
| Insert / move / delete / split / trim, and per-cut transition ops | `src/model/ops.ts`, `src/model/feel.ts` |
| Undo history with gestures | `src/model/history.ts` |
| Library decode planning under the memory cap | `src/model/decodePlan.ts` |
| Insertion points, ruler ticks, zoom | `src/model/timelineView.ts` |
| Frame-accurate pre-decode to ImageBitmaps | `src/media/decoder.ts` |
| WebGL2 renderer and one shader per transition | `src/render/` |
| Single rAF loop for playback and previews | `src/playback/PreviewController.ts` |
| Workspace shell: top bar, resizable sidebar / preview / timeline | `src/ui/Shell.tsx`, `src/ui/Splitter.tsx` |
| Pane size limits, splitter keys, sidebar level | `src/model/layout.ts` |
| Sidebar: Library tab, Transitions tab (level 1 picker, level 2 editor) | `src/ui/LibraryPanel.tsx`, `src/ui/TransitionsPanel.tsx`, `src/ui/Gallery.tsx`, `src/ui/Inspector.tsx` |
| Timeline: clips with trim grips, cuts, transitions | `src/ui/Timeline.tsx`, `src/ui/ClipItem.tsx`, `src/ui/CutZone.tsx`, `src/ui/TransitionItem.tsx` |

All model times are integer frames at 30 fps. Transitions are centred on a cut and always an even number of frames long. A clip's length is shared by the transitions at both of its ends, and trimming into a transition's handle shrinks it down to 2 frames, where the trim stops.

```bash
npm run typecheck
npm test
npm run build
```
