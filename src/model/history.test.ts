import { describe, expect, it } from 'vitest';
import { cutAt, FEEL, shortB } from './fixtures';
import {
  beginGesture,
  canRedo,
  canUndo,
  cancelGesture,
  commit,
  createHistory,
  endGesture,
  redo,
  redoLabel,
  undo,
  undoLabel,
  updateGesture,
} from './history';
import { applyTransition, removeTransition, setDuration } from './ops';
import { docEquals, type Doc } from './timeline';

describe('undo / redo', () => {
  it('commit, undo and redo walk the states', () => {
    let h = createHistory(1);
    h = commit(h, 2, 'two');
    h = commit(h, 3, 'three');
    expect(h.present).toBe(3);
    expect(undoLabel(h)).toBe('three');
    h = undo(h);
    expect(h.present).toBe(2);
    expect(redoLabel(h)).toBe('three');
    h = undo(h);
    expect(h.present).toBe(1);
    expect(canUndo(h)).toBe(false);
    h = undo(h); // no-op at the start
    expect(h.present).toBe(1);
    h = redo(h);
    h = redo(h);
    expect(h.present).toBe(3);
    expect(canRedo(h)).toBe(false);
  });

  it('a new commit clears the redo branch', () => {
    let h = commit(commit(createHistory('a'), 'b', 'b'), 'c', 'c');
    h = undo(h);
    h = commit(h, 'd', 'd');
    expect(h.future).toHaveLength(0);
    expect(redo(h)).toBe(h);
  });

  it('drops no-op commits', () => {
    const h = createHistory(5);
    expect(commit(h, 5, 'same')).toBe(h);
  });

  it('caps the number of steps', () => {
    let h = createHistory(0);
    for (let i = 1; i <= 10; i++) h = commit(h, i, `set ${i}`, Object.is, 3);
    expect(h.past).toHaveLength(3);
    h = undo(undo(undo(h)));
    expect(h.present).toBe(7);
    expect(canUndo(h)).toBe(false);
  });
});

describe('gestures', () => {
  it('a full drag counts as one step', () => {
    let h = createHistory(10);
    h = beginGesture(h);
    for (const v of [12, 14, 16, 18, 20]) h = updateGesture(h, v);
    expect(h.past).toHaveLength(0);
    h = endGesture(h, 'Change duration');
    expect(h.present).toBe(20);
    expect(h.past).toHaveLength(1);
    h = undo(h);
    expect(h.present).toBe(10);
    h = redo(h);
    expect(h.present).toBe(20);
  });

  it('a drag that ends where it started leaves no step', () => {
    let h = createHistory(10);
    h = beginGesture(h);
    h = updateGesture(h, 14);
    h = updateGesture(h, 10);
    h = endGesture(h, 'Change duration');
    expect(h.past).toHaveLength(0);
    expect(h.gesture).toBeNull();
  });

  it('cancel restores the state from before the gesture', () => {
    let h = beginGesture(createHistory(10));
    h = updateGesture(h, 30);
    h = cancelGesture(h);
    expect(h.present).toBe(10);
    expect(h.past).toHaveLength(0);
  });

  it('ignores undo and redo mid-gesture', () => {
    let h = commit(createHistory(1), 2, 'two');
    h = updateGesture(beginGesture(h), 3);
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });

  it('works on real documents with value equality', () => {
    const doc0 = shortB();
    const key = cutAt(doc0).key;
    const start = applyTransition(doc0, key, 'push', FEEL, { feel: 50 });
    if (!start.ok) throw new Error();
    let h = createHistory<Doc>(start.doc);
    h = beginGesture(h);
    for (const d of [26, 28, 30, 28, 24]) h = updateGesture(h, setDuration(h.present, key, d).doc);
    // Back to 24 f with new objects: value-equal, so no step.
    h = endGesture(h, 'Change duration', docEquals);
    expect(h.past).toHaveLength(0);

    h = commit(h, removeTransition(h.present, key), 'Remove transition', docEquals);
    expect(h.present.transitions).toHaveLength(0);
    h = undo(h);
    expect(h.present.transitions[0]?.presetId).toBe('push');
  });
});
