import { clamp, type Frames } from './time';

/** Source frame under a skim position, given as a fraction (0–1) of the thumbnail width. */
export function skimFrame(fraction: number, frames: Frames): Frames {
  if (frames <= 0) return 0;
  return clamp(Math.floor(fraction * frames), 0, frames - 1);
}
