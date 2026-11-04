import { createContext, memo, useContext, useEffect, useRef, useSyncExternalStore } from 'react';
import type { ThumbCache } from '../media/ThumbCache';
import { STRIP_TILE_WIDTH, stripTiles } from '../model/filmstrip';
import type { Frames } from '../model/time';

/** The timeline's thumbnail cache; null while the clips load. */
export const ThumbsContext = createContext<ThumbCache | null>(null);

interface Props {
  sourceId: string;
  sourceIn: Frames;
  sourceOut: Frames;
  /** Clip width in px. */
  width: number;
  ppf: number;
}

const noSubscribe = () => () => {};
const zero = () => 0;

/**
 * Thumbnails across a timeline clip, each showing the source frame under its
 * left edge. Tiles draw the nearest thumbnail decoded so far and sharpen as
 * the exact ones arrive. Purely visual: pointer events pass through to the clip.
 */
export function Filmstrip({ sourceId, sourceIn, sourceOut, width, ppf }: Props) {
  const thumbs = useContext(ThumbsContext);
  const version = useSyncExternalStore(thumbs?.subscribe ?? noSubscribe, thumbs?.getVersion ?? zero);
  const tiles = stripTiles(sourceIn, sourceOut, width, ppf);
  return (
    <div className="clip-strip" aria-hidden="true">
      {tiles.map((t) => (
        <Tile key={t.x} thumbs={thumbs} sourceId={sourceId} frame={t.frame} x={t.x} version={version} />
      ))}
    </div>
  );
}

const Tile = memo(function Tile({
  thumbs,
  sourceId,
  frame,
  x,
  version,
}: {
  thumbs: ThumbCache | null;
  sourceId: string;
  frame: Frames;
  x: number;
  version: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawn = useRef<ImageBitmap | null>(null);

  useEffect(() => {
    thumbs?.want(sourceId, frame);
  }, [thumbs, sourceId, frame]);

  useEffect(() => {
    const canvas = ref.current;
    const bitmap = thumbs?.get(sourceId, frame) ?? null;
    if (!canvas || bitmap === drawn.current) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawn.current = bitmap;
    if (!bitmap) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.classList.remove('ready');
      return;
    }
    if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
    }
    ctx.drawImage(bitmap, 0, 0);
    canvas.classList.add('ready');
  }, [thumbs, sourceId, frame, version]);

  return <canvas ref={ref} className="clip-tile" style={{ left: x, width: STRIP_TILE_WIDTH }} />;
});
