import { useEffect } from 'react';
import { create } from 'zustand';

/**
 * What you're editing by hand (ADR 0046), by artifact. Kept here rather than
 * in the panel, so closing it, switching chats or opening the pinned app
 * doesn't lose a word: the edit is there when you come back. Never written
 * to disk; leaving the page with one unsaved asks first.
 */
export interface Edit {
  content: string;
  /** What it started as: no difference, nothing to lose. */
  original: string;
  /** The newest version when you started; a save over a newer one asks. */
  base: number;
}

interface Edits {
  edits: Record<string, Edit>;
  start(id: string, edit: Edit): void;
  change(id: string, content: string): void;
  stop(id: string): void;
}

export const useEdits = create<Edits>((set) => ({
  edits: {},
  start: (id, edit) => set((s) => ({ edits: { ...s.edits, [id]: edit } })),
  change: (id, content) =>
    set((s) => {
      const edit = s.edits[id];
      return edit ? { edits: { ...s.edits, [id]: { ...edit, content } } } : s;
    }),
  stop: (id) =>
    set((s) => {
      const { [id]: _gone, ...rest } = s.edits;
      return { edits: rest };
    }),
}));

export const isDirty = (edit: Edit | undefined) => Boolean(edit && edit.content !== edit.original);

/** Closing the tab or reloading with an edit unsaved: the browser asks first. */
export function useUnsavedGuard() {
  const dirty = useEdits((s) => Object.values(s.edits).some(isDirty));
  useEffect(() => {
    if (!dirty) return;
    const stay = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', stay);
    return () => window.removeEventListener('beforeunload', stay);
  }, [dirty]);
}
