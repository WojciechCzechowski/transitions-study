/** Roving-focus movement for the one-row preset gallery. Clamps at the ends. */
export function nextGalleryIndex(index: number, key: string, count: number): number | null {
  if (count <= 0) return null;
  const last = count - 1;
  const i = Math.min(Math.max(index, 0), last);
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return Math.min(last, i + 1);
    case 'ArrowLeft':
    case 'ArrowUp':
      return Math.max(0, i - 1);
    case 'Home':
      return 0;
    case 'End':
      return last;
    default:
      return null;
  }
}
