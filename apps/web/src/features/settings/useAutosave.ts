import { useEffect, useRef, useState } from 'react';

/**
 * Saves `value` shortly after it stops changing. Returns a status for a quiet
 * "Saving… / Saved" indicator. Unchanged values never save.
 */
export function useAutosave<T>(value: T, save: (value: T) => Promise<unknown>, delay = 600) {
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
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
  return status;
}
