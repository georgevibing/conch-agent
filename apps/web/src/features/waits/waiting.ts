import type { WaitNote } from '@conch/protocol';

import type { TranscriptItem } from '../../live/reducer';

/** The latest thing this chat still waits for (ADR 0125), if any. */
export function waitingFor(items: readonly TranscriptItem[]): WaitNote | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item?.kind === 'wait' && item.wait.state === 'watching') return item.wait;
  }
  return undefined;
}
