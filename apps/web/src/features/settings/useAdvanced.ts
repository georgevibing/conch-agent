import { useEffect, useState } from 'react';

import { useUi } from '../../app/ui';

/**
 * `openSettings(tab, ADVANCED_FOCUS)` opens a place with its Advanced already
 * open — what ⌘K uses for a setting that lives in there.
 */
export const ADVANCED_FOCUS = 'advanced';

/**
 * Holds a page's **Advanced** open (Nacre `SettingsAdvanced`).
 *
 * A settings page keeps what almost nobody changes behind one disclosure, so
 * ⌘K, a checkup's fix and a link must still reach what moved in there: give
 * this hook the focus names of the sections inside, and it opens before they're
 * drawn. The focus itself is left alone — the section reads it and brings
 * itself into view, as it does anywhere else. `ADVANCED_FOCUS` always counts.
 */
export function useAdvanced(...inside: string[]): [boolean, (open: boolean) => void] {
  const names = [ADVANCED_FOCUS, ...inside].join(' ');
  const [open, setOpen] = useState(() => {
    const focus = useUi.getState().settingsFocus;
    return Boolean(focus && names.split(' ').includes(focus));
  });
  useEffect(() => {
    const wanted = names.split(' ');
    return useUi.subscribe((state, before) => {
      const focus = state.settingsFocus;
      if (focus === before.settingsFocus || !focus) return;
      if (wanted.includes(focus)) setOpen(true);
    });
  }, [names]);
  return [open, setOpen];
}
