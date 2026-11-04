import { describe, expect, it } from 'vitest';
import { skimFrame } from './skim';

describe('skimFrame', () => {
  it('maps the pointer across the thumbnail onto the whole clip', () => {
    expect(skimFrame(0, 120)).toBe(0);
    expect(skimFrame(0.5, 120)).toBe(60);
    expect(skimFrame(0.999, 120)).toBe(119);
  });

  it('stays inside the clip at and past the edges', () => {
    expect(skimFrame(1, 120)).toBe(119);
    expect(skimFrame(-0.1, 120)).toBe(0);
    expect(skimFrame(1.2, 120)).toBe(119);
    expect(skimFrame(0.5, 0)).toBe(0);
  });
});
