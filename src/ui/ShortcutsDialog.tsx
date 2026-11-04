import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { isMac, isTextEntry, modKey } from './hooks';

/** The key that opens and closes the list. ⌘H isn't usable: macOS hides the browser on it. */
const OPEN_KEY = '?';

interface Shortcut {
  keys: ReactNode;
  action: string;
}

const k = (...keys: string[]) => (
  <span className="keys">
    {keys.map((key) => (
      <kbd key={key}>{key}</kbd>
    ))}
  </span>
);

const GROUPS: { title: string; items: Shortcut[] }[] = [
  {
    title: 'Playback',
    items: [{ keys: k('Space'), action: 'Play / pause' }],
  },
  {
    title: 'Editing',
    items: [
      { keys: k('S'), action: 'Split at the playhead' },
      { keys: k('W'), action: 'Insert the last played Library clip at the playhead' },
      { keys: k('I', 'O'), action: 'Mark in / out on the Library clip in the preview' },
      { keys: k('Delete'), action: 'Remove the selection' },
      { keys: k('Alt', '←', '→'), action: 'Move the focused clip' },
      { keys: k('Esc'), action: 'Step back: return from a Library clip to the timeline, stop a loop, leave the picker, or clear the selection' },
    ],
  },
  {
    title: 'History',
    items: [
      { keys: k(modKey, 'Z'), action: 'Undo' },
      { keys: k('⇧', modKey, 'Z'), action: isMac ? 'Redo' : 'Redo (Ctrl Y also works)' },
    ],
  },
  {
    title: 'Help',
    items: [{ keys: k(OPEN_KEY), action: 'Show or hide this list' }],
  },
];

/** Top-bar button and the modal listing the editor's keyboard shortcuts. */
export function ShortcutsDialog() {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  // Mirror state onto the native modal (focus containment, Esc, inert page).
  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== OPEN_KEY || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (isTextEntry(e.target as HTMLElement | null)) return;
      e.preventDefault();
      setOpen((o) => !o);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // A click on the backdrop lands on the <dialog> itself; the content is wrapped.
  const onDialogClick = (e: MouseEvent<HTMLDialogElement>) => {
    if (e.target === e.currentTarget) setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        className="btn btn-small topbar-help"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-keyshortcuts="?"
      >
        Shortcuts <kbd aria-hidden="true">{OPEN_KEY}</kbd>
      </button>
      <dialog ref={dialogRef} className="modal" aria-labelledby={titleId} onClose={() => setOpen(false)} onClick={onDialogClick}>
        <div className="modal-content">
          <header className="modal-head">
            <h2 id={titleId}>Keyboard shortcuts</h2>
            <button type="button" className="btn-icon" onClick={() => setOpen(false)} aria-label="Close">
              <span aria-hidden="true">×</span>
            </button>
          </header>
          <div className="modal-body">
            {GROUPS.map((g) => (
              <section key={g.title} className="shortcut-group">
                <h3>{g.title}</h3>
                <dl className="shortcut-list">
                  {g.items.map((s) => (
                    <div key={s.action} className="shortcut-row">
                      <dt>{s.action}</dt>
                      <dd>{s.keys}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </div>
      </dialog>
    </>
  );
}
