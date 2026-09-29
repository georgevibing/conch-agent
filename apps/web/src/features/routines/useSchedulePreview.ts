import type { Schedule, SchedulePreview } from '@conch/protocol';
import { useEffect, useState } from 'react';

import { routinesApi } from './api';

/** Server-computed preview of a schedule, debounced while you edit. */
export function useSchedulePreview(schedule: Schedule, timezone: string) {
  const key = JSON.stringify({ schedule, timezone });
  const [result, setResult] = useState<{ key: string; preview: SchedulePreview }>();

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      const { schedule: s, timezone: tz } = JSON.parse(key) as {
        schedule: Schedule;
        timezone: string;
      };
      routinesApi
        .preview(s, tz)
        .catch((): SchedulePreview => ({
          valid: false,
          text: '',
          next: [],
          error: 'Couldn’t check this schedule.',
        }))
        .then((preview) => {
          if (!cancelled) setResult({ key, preview });
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [key]);

  // Keep showing the last preview while a new one loads, so nothing jumps.
  return { preview: result?.preview, loading: result?.key !== key };
}
