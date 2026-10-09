import type { WaitNote } from '@conch/protocol';
import { WaitingRow, toast } from '@conch/nacre';
import { useState } from 'react';

import { waitsApi } from './api';

/**
 * Something the assistant waits for in this chat (ADR 0125), as its one row:
 * Check now looks sooner, Stop waiting ends it. Conch watches by itself; no
 * model is called until it ends.
 */
export function WaitItem({ wait, conversationId }: { wait: WaitNote; conversationId?: string }) {
  // Seen while it was still going: its end is news, and said once.
  const [live] = useState(() => wait.state === 'watching');
  const act = (action: 'check' | 'stop') => {
    if (!conversationId) return;
    waitsApi.act(conversationId, wait.waitId, action).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'That didn’t go through. Try again.');
    });
  };
  return (
    <WaitingRow
      kind={wait.kind}
      title={wait.title}
      state={wait.state}
      status={wait.status}
      startedAt={wait.startedAt}
      {...(wait.tone && { tone: wait.tone })}
      {...(wait.parts && { parts: wait.parts })}
      {...(wait.endedAt !== undefined && { endedAt: wait.endedAt })}
      {...(wait.nextCheckAt !== undefined && { nextCheckAt: wait.nextCheckAt })}
      {...(wait.url && { url: wait.url })}
      wakes={Boolean(wait.wakes)}
      tell={Boolean(wait.tell)}
      {...(conversationId && { onCheck: () => act('check'), onStop: () => act('stop') })}
      arriving={live}
    />
  );
}
