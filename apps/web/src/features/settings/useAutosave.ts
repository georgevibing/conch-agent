import { useEffect, useRef, useState } from 'react';

type Status = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Saves `value` shortly after it stops changing. Returns a status for a quiet
 * "Saving… / Saved" indicator. Unchanged values never save.
 */
export function useAutosave<T>(value: T, save: (value: T) => Promise<unknown>, delay = 600) {
  return useAutosaveState(value, save, delay).status;
}

/**
 * `useAutosave`, plus `settle(value)`: say a value was saved some other way
 * (a Save button nearby, say), so taking it into the form doesn't save it twice.
 */
export function useAutosaveState<T>(
  value: T,
  save: (value: T) => Promise<unknown>,
  delay = 600,
): { status: Status; settle: (value: T) => void } {
  const [status, setStatus] = useState<Status>('idle');
  const saveRef = useRef(save);
  const serialised = JSON.stringify(value);
  const lastSaved = useRef(serialised);
  useEffect(() => {
    saveRef.current = save;
  });
  useEffect(() => {
    if (serialised === lastSaved.current) return;
    const t = setTimeout(() => {
      lastSaved.current = serialised;
      setStatus('saving');
      saveRef.current(JSON.parse(serialised) as T).then(
        () => setStatus('saved'),
        () => setStatus('error'),
      );
    }, delay);
    return () => clearTimeout(t);
  }, [serialised, delay]);
  const settle = (next: T) => {
    lastSaved.current = JSON.stringify(next);
  };
  return { status, settle };
}
