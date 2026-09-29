import { useEffect, useRef } from 'react';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * `mod+shift+o` style hotkeys. `mod` is ⌘ on Apple platforms and Ctrl elsewhere.
 * Ignored while typing in a field unless `allowInInputs` is set.
 */
export function useHotkey(
  combo: string,
  handler: (event: KeyboardEvent) => void,
  allowInInputs = true,
) {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    const parts = combo.toLowerCase().split('+');
    const key = parts.at(-1);
    const wants = {
      mod: parts.includes('mod'),
      shift: parts.includes('shift'),
      alt: parts.includes('alt'),
    };
    const onKey = (event: KeyboardEvent) => {
      const mod = isMac ? event.metaKey : event.ctrlKey;
      if (mod !== wants.mod || event.shiftKey !== wants.shift || event.altKey !== wants.alt) return;
      if (event.key.toLowerCase() !== key && event.code.toLowerCase() !== `key${key}`) return;
      const target = event.target as HTMLElement | null;
      if (!allowInInputs && target?.closest('input, textarea, [contenteditable]')) return;
      event.preventDefault();
      ref.current(event);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [combo, allowInInputs]);
}
