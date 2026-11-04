# Transition study

An unofficial interaction study of transitions between two clips in a browser video editor. React, TypeScript, Vite, Vitest and WebGL2. No backend.

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
| Clip layout, handle scenarios, decode memory cap | `src/config/study.config.ts` |
| Timeline model, limits, frame mapping | `src/model/timeline.ts` |
| Apply / remove / duration / Feel ops | `src/model/ops.ts`, `src/model/feel.ts` |
| Undo history with gestures | `src/model/history.ts` |
| Decode planning under the memory cap | `src/model/decodePlan.ts` |
| Frame-accurate pre-decode to ImageBitmaps | `src/media/decoder.ts` |
| WebGL2 renderer and one shader per transition | `src/render/` |
| Single rAF loop for playback and previews | `src/playback/PreviewController.ts` |
| Workspace shell: top bar, resizable sidebar / preview / timeline | `src/ui/Shell.tsx`, `src/ui/Splitter.tsx` |
| Pane size limits, splitter keys, sidebar level | `src/model/layout.ts` |
| Transitions sidebar: level 1 picker, level 2 editor | `src/ui/TransitionsPanel.tsx`, `src/ui/Gallery.tsx`, `src/ui/Inspector.tsx` |

All model times are integer frames at 30 fps. Transitions are centred on the cut and always an even number of frames long.

```bash
npm run typecheck
npm test
npm run build
```
