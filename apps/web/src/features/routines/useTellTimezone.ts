import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { browserTimezone, routinesApi } from './api';
import { routineKeys } from './queries';

/**
 * Tells Conch this device's timezone once it opens, so a routine the assistant
 * schedules for 10:00 runs at 10:00 here, not on the gateway's clock (a server is
 * often on UTC). Routines that ran on the wrong clock move over by themselves.
 */
export function useTellTimezone() {
  const client = useQueryClient();
  useEffect(() => {
    routinesApi
      .timezone(browserTimezone())
      .then(({ moved }) => {
        if (moved) void client.invalidateQueries({ queryKey: routineKeys.all });
      })
      .catch(() => undefined);
  }, [client]);
}
