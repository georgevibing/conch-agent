import type { Trigger, WhenPreview } from '@conch/protocol';
import { useEffect, useState } from 'react';

import { routinesApi } from './api';

/** The gateway's words for what starts a routine (ADR 0056), debounced while you edit. */
export function useWhenPreview(when: Trigger | undefined, onlyIf: string) {
  const key = when ? JSON.stringify({ when, onlyIf }) : '';
  const [result, setResult] = useState<{ key: string; preview: WhenPreview }>();

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const t = setTimeout(() => {
      const body = JSON.parse(key) as { when: Trigger; onlyIf: string };
      routinesApi
        .previewWhen(body.when, body.onlyIf)
        .catch((): WhenPreview => ({
          valid: false,
          text: '',
          error: 'Couldn’t check this. Try again in a moment.',
        }))
        .then((preview) => {
          if (!cancelled) setResult({ key, preview });
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [key]);

  return {
    preview: key ? result?.preview : undefined,
    loading: Boolean(key) && result?.key !== key,
  };
}
